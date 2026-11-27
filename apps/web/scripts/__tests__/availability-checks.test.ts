// @vitest-environment node
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { IPFS_GATEWAYS, ORBITOR_IPFS_GATEWAY } from "@cobuilders/safenet-core"
import { CID } from "multiformats/cid"
import * as raw from "multiformats/codecs/raw"
import { sha256 } from "multiformats/hashes/sha2"
import { describe, it, expect } from "vitest"
import {
  annotation,
  applyAvailabilityPolicy,
  type Outcome,
  checkAlerts,
  checkApi,
  checkEns,
  checkGateway,
  checkProduction,
  ensOrigin,
  entryAsset,
  pageTitle,
  summary,
  type Fetch,
} from "../availability-checks"

/** A CIDv1 of the given text, so fixtures pass the parser's CID check without a real release. */
const cidOf = async (text: string) => CID.create(1, raw.code, await sha256.digest(new TextEncoder().encode(text))).toString()
const CID_A = await cidOf("a")
const CID_B = await cidOf("b")

const TITLE = "Safenet Staking"
const BASE = "https://app.example.test/"
const INDEX = `<!doctype html><html><head><title>${TITLE}</title>
<script type="module" crossorigin src="./assets/index-AbC123.js"></script>
<link rel="modulepreload" crossorigin href="./assets/vendor-ui-Xy.js"></head><body></body></html>`

/** A fetch that answers from a map of URL to Response, or throws the error given for that URL. */
function fakeFetch(routes: Record<string, Response | Error>): Fetch & { urls: string[] } {
  const urls: string[] = []
  const fetchImpl = async (url: string) => {
    urls.push(url)
    const route = routes[url]
    if (route instanceof Error) throw route
    if (!route) return new Response("not found", { status: 404 })
    return route
  }
  return Object.assign(fetchImpl, { urls })
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } })
const js = (body: string, type = "text/javascript") => new Response(body, { status: 200, headers: { "content-type": type } })
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
/**
 * A 200 whose headers arrived and whose body stream then fails with `error`, as undici's body does
 * when the timeout signal fires mid-body. `new Response(text)` cannot fail, so it needs a stream.
 */
const stalled = (error: Error, type = "text/html") =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`<title>${TITLE.slice(0, 4)}`))
        controller.error(error)
      },
    }),
    { status: 200, headers: { "content-type": type } },
  )

describe("pageTitle and entryAsset", () => {
  it("reads the title", () => {
    expect(pageTitle(INDEX)).toBe(TITLE)
    expect(pageTitle("<html><title>\n  Spaced  \n</title></html>")).toBe("Spaced")
    expect(pageTitle("<html></html>")).toBeUndefined()
  })

  it("finds the module script under assets/, not a preload or the source entry", () => {
    expect(entryAsset(INDEX)).toBe("./assets/index-AbC123.js")
    expect(entryAsset('<script type="module" src="/src/main.tsx"></script>')).toBeUndefined()
    expect(entryAsset('<script src="./assets/legacy.js"></script>')).toBeUndefined()
    expect(entryAsset("<html></html>")).toBeUndefined()
  })
})

describe("checkProduction", () => {
  it("passes when the index has the title and its entry script answers as JavaScript", async () => {
    const fetchImpl = fakeFetch({ [BASE]: html(INDEX), [`${BASE}assets/index-AbC123.js`]: js("export{}") })
    const outcomes = await checkProduction(fetchImpl, BASE, TITLE)
    expect(outcomes.map((o) => o.ok)).toEqual([true, true])
    expect(fetchImpl.urls).toEqual([BASE, `${BASE}assets/index-AbC123.js`])
  })

  it("resolves the script against a deployment served from a path", async () => {
    const base = "https://host.example.test/app/"
    const fetchImpl = fakeFetch({ [base]: html(INDEX), [`${base}assets/index-AbC123.js`]: js("export{}") })
    expect((await checkProduction(fetchImpl, base, TITLE)).every((o) => o.ok)).toBe(true)
  })

  it("fails on an index that does not answer 200, and checks nothing else", async () => {
    const outcomes = await checkProduction(fakeFetch({ [BASE]: html("down", 503) }), BASE, TITLE)
    expect(outcomes).toEqual([{ target: "production", ok: false, detail: "index answered 503" }])
  })

  it("fails on an index that does not answer in time", async () => {
    const outcomes = await checkProduction(fakeFetch({ [BASE]: timeout() }), BASE, TITLE, 2_000)
    expect(outcomes[0]).toMatchObject({ ok: false, detail: "index: no answer in 2 s" })
  })

  it("fails on a request that errors", async () => {
    const outcomes = await checkProduction(fakeFetch({ [BASE]: new TypeError("fetch failed") }), BASE, TITLE)
    expect(outcomes[0]).toMatchObject({ ok: false, detail: "index: request failed: fetch failed" })
  })

  it("fails on another title, or none", async () => {
    const other = await checkProduction(fakeFetch({ [BASE]: html(INDEX.replace(TITLE, "Parked")) }), BASE, TITLE)
    expect(other[0]).toMatchObject({ ok: false, detail: `index title is "Parked", expected "${TITLE}"` })
    const none = await checkProduction(fakeFetch({ [BASE]: html("<html></html>") }), BASE, TITLE)
    expect(none[0]).toMatchObject({ ok: false, detail: `index title is missing, expected "${TITLE}"` })
  })

  it("fails when the index names no entry script", async () => {
    const outcomes = await checkProduction(fakeFetch({ [BASE]: html(`<title>${TITLE}</title>`) }), BASE, TITLE)
    expect(outcomes[1]).toEqual({ target: "production", ok: false, detail: "index names no entry script under assets/" })
  })

  it("fails when the entry script is gone, served as HTML, empty, or does not answer", async () => {
    const asset = `${BASE}assets/index-AbC123.js`
    const gone = await checkProduction(fakeFetch({ [BASE]: html(INDEX) }), BASE, TITLE)
    expect(gone[1]).toMatchObject({ ok: false, detail: expect.stringContaining("answered 404") })
    const fallback = await checkProduction(fakeFetch({ [BASE]: html(INDEX), [asset]: html(INDEX) }), BASE, TITLE)
    expect(fallback[1]).toMatchObject({ ok: false, detail: expect.stringContaining('as "text/html"') })
    const empty = await checkProduction(fakeFetch({ [BASE]: html(INDEX), [asset]: js("") }), BASE, TITLE)
    expect(empty[1]).toMatchObject({ ok: false, detail: expect.stringContaining("0 bytes") })
    const slow = await checkProduction(fakeFetch({ [BASE]: html(INDEX), [asset]: timeout() }), BASE, TITLE, 1_000)
    expect(slow[1]).toMatchObject({ ok: false, detail: "./assets/index-AbC123.js: no answer in 1 s" })
  })
})

describe("a body that stalls after the headers", () => {
  it("is a FAIL outcome for the production index, not a rejection", async () => {
    const outcomes = await checkProduction(fakeFetch({ [BASE]: stalled(timeout()) }), BASE, TITLE, 2_000)
    expect(outcomes).toEqual([{ target: "production", ok: false, detail: "index: answered, but the body did not finish in 2 s" }])
  })

  it("is a FAIL outcome for the entry script, after the index passed", async () => {
    const asset = `${BASE}assets/index-AbC123.js`
    const outcomes = await checkProduction(fakeFetch({ [BASE]: html(INDEX), [asset]: stalled(timeout(), "text/javascript") }), BASE, TITLE, 2_000)
    expect(outcomes.map((o) => o.ok)).toEqual([true, false])
    expect(outcomes[1].detail).toBe("./assets/index-AbC123.js: answered, but the body did not finish in 2 s")
  })

  it("is a FAIL outcome for a gateway", async () => {
    const url = "https://gw.example.test/ipfs/bafy1/index.html"
    const outcome = await checkGateway(fakeFetch({ [url]: stalled(timeout()) }), "https://gw.example.test", "bafy1", TITLE, 60_000)
    expect(outcome).toMatchObject({ ok: false, detail: "answered, but the body did not finish in 60 s" })
  })

  it("names another body error as such", async () => {
    const outcome = await checkGateway(fakeFetch({ "https://gw.example.test/ipfs/bafy1/index.html": stalled(new TypeError("terminated")) }), "https://gw.example.test", "bafy1", TITLE)
    expect(outcome).toMatchObject({ ok: false, detail: "answered, but the body failed: terminated" })
  })

  it("is a FAIL outcome against a real server that stalls mid-body, with the real fetch", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" })
      response.write(`<title>${TITLE}</title>`) // and never ends
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
      const outcomes = await checkProduction(fetch, base, TITLE, 500)
      expect(outcomes).toEqual([{ target: "production", ok: false, detail: "index: answered, but the body did not finish in 0.5 s" }])
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })
})

describe("checkGateway", () => {
  const gateway = "https://gw.example.test"
  const url = `${gateway}/ipfs/bafy1/index.html`

  it("passes on 200 with the title, whatever else the gateway injects", async () => {
    const outcome = await checkGateway(fakeFetch({ [url]: html(INDEX.replace("</head>", "<script>challenge()</script></head>")) }), gateway, "bafy1", TITLE)
    expect(outcome).toMatchObject({ target: gateway, ok: true })
  })

  it("fails on another status", async () => {
    expect(await checkGateway(fakeFetch({ [url]: html("", 429) }), gateway, "bafy1", TITLE)).toMatchObject({ ok: false, detail: "answered 429" })
  })

  it("fails on another title", async () => {
    const outcome = await checkGateway(fakeFetch({ [url]: html("<title>Gateway</title>") }), gateway, "bafy1", TITLE)
    expect(outcome).toMatchObject({ ok: false, detail: 'index.html of bafy1 has the title "Gateway"' })
  })

  it("fails on no title", async () => {
    const outcome = await checkGateway(fakeFetch({ [url]: html("<html></html>") }), gateway, "bafy1", TITLE)
    expect(outcome).toMatchObject({ ok: false, detail: "index.html of bafy1 has the title missing" })
  })

  it("fails when the gateway does not answer in time", async () => {
    expect(await checkGateway(fakeFetch({ [url]: timeout() }), gateway, "bafy1", TITLE, 60_000)).toMatchObject({
      ok: false,
      detail: "no answer in 60 s",
    })
  })
})

describe("checkEns", () => {
  const ens = ensOrigin("app.example.eth")
  const withRoots = (body: string, roots: string | undefined) =>
    new Response(body, { status: 200, headers: { "content-type": "text/html", ...(roots === undefined ? {} : { "x-ipfs-roots": roots }) } })

  it("is eth.limo for the name", () => {
    expect(ens).toBe("https://app.example.eth.limo/")
  })

  it("passes, and returns the root CID, when ENS serves production's index", async () => {
    const result = await checkEns(fakeFetch({ [ens]: withRoots(INDEX, `${CID_A},${CID_B}`), [BASE]: html(INDEX) }), ens, BASE, TITLE)
    expect(result.cid).toBe(CID_A)
    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, true])
    expect(result.outcomes[1].detail).toBe(`serves ${CID_A}`)
  })

  it("fails loudly when ENS and production serve different builds, naming both entry scripts", async () => {
    const other = INDEX.replace("index-AbC123.js", "index-Old999.js")
    const result = await checkEns(fakeFetch({ [ens]: withRoots(other, CID_A), [BASE]: html(INDEX) }), ens, BASE, TITLE)
    expect(result.cid).toBe(CID_A)
    expect(result.outcomes[2]).toMatchObject({
      ok: false,
      detail: expect.stringContaining("ENS names ./assets/index-Old999.js, production ./assets/index-AbC123.js"),
    })
  })

  it("fails without a CID when the header is missing or not a CID", async () => {
    const none = await checkEns(fakeFetch({ [ens]: withRoots(INDEX, undefined), [BASE]: html(INDEX) }), ens, BASE, TITLE)
    expect(none.cid).toBeUndefined()
    expect(none.outcomes[1]).toMatchObject({ ok: false, detail: "names no root CID in x-ipfs-roots" })
    const bad = await checkEns(fakeFetch({ [ens]: withRoots(INDEX, "bafy-not-a-cid"), [BASE]: html(INDEX) }), ens, BASE, TITLE)
    expect(bad.cid).toBeUndefined()
    expect(bad.outcomes[1]).toMatchObject({ ok: false, detail: 'x-ipfs-roots names "bafy-not-a-cid", which is not a CID' })
  })

  it("fails on an ENS origin that is down, and checks nothing else", async () => {
    const fetchImpl = fakeFetch({ [ens]: html("bad gateway", 502), [BASE]: html(INDEX) })
    const result = await checkEns(fetchImpl, ens, BASE, TITLE)
    expect(result).toEqual({ outcomes: [{ target: "ENS", ok: false, detail: "index answered 502" }] })
    expect(fetchImpl.urls).toEqual([ens])
  })

  it("fails on another title, and does not claim a match when production is down", async () => {
    const result = await checkEns(fakeFetch({ [ens]: withRoots("<title>Parked</title>", CID_A), [BASE]: html("", 503) }), ens, BASE, TITLE)
    expect(result.outcomes[0]).toMatchObject({ ok: false, detail: `index title is "Parked", expected "${TITLE}"` })
    expect(result.outcomes[2]).toMatchObject({ ok: false, detail: "not compared with production: production did not answer 200" })
  })
})

describe("checkApi", () => {
  const list = "https://api.example.test/v1/validators"
  const health = "https://api.example.test/v1/health"
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

  it("passes on status ok and a non-empty list", async () => {
    const outcomes = await checkApi(fakeFetch({ [health]: json({ status: "ok" }), [list]: json([{ address: "0x" }]) }), list)
    expect(outcomes).toEqual([
      { target: "API", ok: true, detail: '/v1/health answered 200 with status "ok"' },
      { target: "API", ok: true, detail: "validators answered 200 with 1 entries" },
    ])
  })

  it("fails on a degraded health, an empty list, or a list that is not one", async () => {
    const degraded = await checkApi(fakeFetch({ [health]: json({ status: "degraded" }), [list]: json([]) }), list)
    expect(degraded.map((o) => o.detail)).toEqual([
      '/v1/health answered 200 with status "degraded"',
      "validators answered 200 with an empty list",
    ])
    const object = await checkApi(fakeFetch({ [health]: json({}), [list]: json({ error: "x" }) }), list)
    expect(object.map((o) => o.detail)).toEqual([
      "/v1/health answered 200 with status null",
      "validators answered 200 with a body that is not a list",
    ])
  })

  it("fails on another status, a body that is not JSON, or no answer", async () => {
    const outcomes = await checkApi(fakeFetch({ [health]: json({ status: "degraded" }, 503), [list]: new Response("<html>", { status: 200 }) }), list)
    expect(outcomes.map((o) => o.detail)).toEqual(["/v1/health answered 503", "validators answered 200 with a body that is not JSON"])
    const slow = await checkApi(fakeFetch({ [health]: timeout(), [list]: timeout() }), list, 1_000)
    expect(slow.map((o) => o.detail)).toEqual(["/v1/health no answer in 1 s", "validators no answer in 1 s"])
  })
})

describe("checkAlerts", () => {
  const url = "https://alerts.example.test"
  const health = `${url}/health`
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

  it("passes on healthy true", async () => {
    expect(await checkAlerts(fakeFetch({ [health]: json({ healthy: true }) }), url)).toEqual({
      target: "alerts", ok: true, detail: "/health answered 200 with healthy true",
    })
  })

  it("fails on 503, on healthy false, and on a missing field", async () => {
    expect(await checkAlerts(fakeFetch({ [health]: json({ healthy: false }, 503) }), url)).toMatchObject({ ok: false, detail: "/health answered 503" })
    expect(await checkAlerts(fakeFetch({ [health]: json({ healthy: false }) }), url)).toMatchObject({ ok: false })
    expect(await checkAlerts(fakeFetch({ [health]: json({ healthy: "true" }) }), url)).toMatchObject({ ok: false })
  })
})

describe("annotation", () => {
  it("is a notice for a pass and an error for a failure", () => {
    expect(annotation({ target: "production", ok: true, detail: "fine" })).toBe("::notice title=Availability%3A production::fine")
    expect(annotation({ target: "production", ok: false, detail: "down" })).toBe("::error title=Availability%3A production::down")
  })

  it("escapes what the runner would read as syntax", () => {
    expect(annotation({ target: "https://gw.example.test", ok: false, detail: "50% done\nnext" })).toBe(
      "::error title=Availability%3A https%3A//gw.example.test::50%25 done%0Anext",
    )
  })
})

describe("summary", () => {
  it("writes one row per outcome and names the CID checked", () => {
    const text = summary(
      [
        { target: "production", ok: true, detail: "fine" },
        { target: "https://gw.example.test", ok: false, detail: "a | b" },
      ],
      "bafy1",
    )
    expect(text).toContain("| production | OK | fine |")
    expect(text).toContain("| https://gw.example.test | FAIL | a \\| b |")
    expect(text).toContain("checked for `bafy1`, the CID the ENS name serves")
  })

  it("escapes what a target served, so a detail cannot add a link, an image or a row", () => {
    const text = summary([{ target: "https://gw.example.test", ok: false, detail: 'title "![x](https://evil.test/a.png) [y](z)"\n| new | row |' }], undefined)
    expect(text).toContain('title "!\\[x\\]\\(https://evil.test/a.png\\) \\[y\\]\\(z\\)" \\| new \\| row \\|')
    expect(text.split("\n").filter((line) => line.startsWith("| https://gw.example.test"))).toHaveLength(1)
  })

  it("says IPFS was not checked when the ENS name served no CID", () => {
    expect(summary([], undefined)).toContain("IPFS: not checked. The ENS name served no CID.")
  })
})

describe("availability.ts", () => {
  it("refuses to run without its URLs, and names each one missing", () => {
    const env = { ...process.env, PRODUCTION_URL: "", VALIDATOR_INFO_URL: "", ALERTS_API_URL: " " }
    // Cold Node/tsx startup competes with other packages in CI. This checks the error contract,
    // not startup speed. Bound the child too, since spawnSync blocks the test runner's timer.
    const run = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../availability.ts")], { env, encoding: "utf8", timeout: 20_000 })
    expect(run.error).toBeUndefined()
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("PRODUCTION_URL, VALIDATOR_INFO_URL, ALERTS_API_URL are not set")
  }, 30_000)
})


describe("availability gateway policy", () => {
  const healthy: Outcome[] = [
    { target: "production", ok: true, detail: "HTML 200" },
    { target: "production", ok: true, detail: "JavaScript 200" },
    ...IPFS_GATEWAYS.map(target => ({ target, ok: true, detail: "index 200" })),
  ]
  const failure = (target: string, httpStatus: number) => healthy.map(o => o.target === target
    ? { ...o, ok: false, httpStatus, detail: `answered ${httpStatus}` } : o)

  it("warns for Orbitor 504 only after every required path passed", () => {
    const result = applyAvailabilityPolicy(failure(ORBITOR_IPFS_GATEWAY, 504))
    const warning = result.find(o => o.target === ORBITOR_IPFS_GATEWAY)!
    expect(warning).toMatchObject({ ok: false, advisory: true, httpStatus: 504 })
    expect(result.filter(o => !o.ok && !o.advisory)).toEqual([])
    expect(annotation(warning)).toMatch(/^::warning /)
    expect(summary(result, undefined)).toContain("WARN (non-blocking)")
  })

  it("warns when the actual gateway probe returns Orbitor HTTP 504", async () => {
    const gateway = await checkGateway(
      fakeFetch({ [`${ORBITOR_IPFS_GATEWAY}/ipfs/bafy1/index.html`]: html("", 504) }),
      ORBITOR_IPFS_GATEWAY, "bafy1", TITLE,
    )
    const outcomes = applyAvailabilityPolicy([
      ...healthy.filter(o => o.target !== ORBITOR_IPFS_GATEWAY), gateway,
    ])
    expect(outcomes.find(o => o.target === ORBITOR_IPFS_GATEWAY)).toMatchObject({
      ok: false, advisory: true, httpStatus: 504,
    })
    expect(outcomes.filter(o => !o.ok && !o.advisory)).toEqual([])
  })

  it("blocks every other gateway status and any production or required-gateway failure", () => {
    for (const gateway of IPFS_GATEWAYS) {
      for (const status of [404, 429, 500, 503, 504]) {
        if (gateway === ORBITOR_IPFS_GATEWAY && status === 504) continue
        expect(applyAvailabilityPolicy(failure(gateway, status)).some(o => !o.ok && !o.advisory)).toBe(true)
      }
    }
    for (const i of [0, 1, ...healthy.map((o, i) => o.target !== "production" && o.target !== ORBITOR_IPFS_GATEWAY ? i : -1).filter(i => i >= 0)]) {
      const both = failure(ORBITOR_IPFS_GATEWAY, 504)
      both[i] = { ...both[i]!, ok: false, detail: "unavailable" }
      expect(applyAvailabilityPolicy(both).filter(o => o.advisory)).toEqual([])
    }
  })

  it("does not relax missing checks, transport errors, or title mismatches", () => {
    const timedOut = failure(ORBITOR_IPFS_GATEWAY, 504)
    for (const i of [0, 1, ...timedOut.map((o, i) => o.target !== ORBITOR_IPFS_GATEWAY ? i : -1).filter(i => i >= 0)]) {
      expect(applyAvailabilityPolicy(timedOut.filter((_, j) => i !== j)).some(o => o.advisory)).toBe(false)
    }
    for (const detail of ["no answer in 60 s", "wrong title", "answered 504"]) {
      const result = healthy.map(o => o.target === ORBITOR_IPFS_GATEWAY ? { ...o, ok: false, detail } : o)
      expect(applyAvailabilityPolicy(result).some(o => o.advisory)).toBe(false)
    }
  })
})
