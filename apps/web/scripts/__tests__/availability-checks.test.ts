// @vitest-environment node
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import {
  annotation,
  checkGateway,
  checkProduction,
  entryAsset,
  latestDeployment,
  pageTitle,
  parseDeployments,
  summary,
  type Fetch,
} from "../availability-checks"

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

describe("parseDeployments", () => {
  it("reads an array of records", () => {
    const text = JSON.stringify([{ cid: "bafy1", tag: "v1.0.0", pinnedAt: "2026-11-01T00:00:00Z" }])
    expect(parseDeployments(text)).toEqual([{ cid: "bafy1", tag: "v1.0.0", pinnedAt: "2026-11-01T00:00:00Z" }])
  })

  it("drops fields it does not know", () => {
    const text = JSON.stringify([{ cid: "bafy1", tag: "v1", pinnedAt: "2026-11-01", note: "x" }])
    expect(parseDeployments(text)[0]).not.toHaveProperty("note")
  })

  it("reads an empty array as no release", () => {
    expect(parseDeployments("[]")).toEqual([])
  })

  it("rejects text that is not JSON", () => {
    expect(() => parseDeployments("{")).toThrow("deployments.json is not JSON")
  })

  it("rejects JSON that is not an array", () => {
    expect(() => parseDeployments('{"cid":"bafy1"}')).toThrow("deployments.json is not an array")
  })

  it.each(["cid", "tag", "pinnedAt"])("rejects an entry without %s, naming it", (field) => {
    const entry: Record<string, unknown> = { cid: "bafy1", tag: "v1", pinnedAt: "2026-11-01" }
    delete entry[field]
    expect(() => parseDeployments(JSON.stringify([entry]))).toThrow(`entry 0 has no ${field}`)
  })

  it("rejects an empty string and a non-string", () => {
    expect(() => parseDeployments(JSON.stringify([{ cid: " ", tag: "v1", pinnedAt: "2026-11-01" }]))).toThrow("has no cid")
    expect(() => parseDeployments(JSON.stringify([{ cid: "bafy1", tag: 1, pinnedAt: "2026-11-01" }]))).toThrow("has no tag")
  })

  it("rejects a null entry", () => {
    expect(() => parseDeployments("[null]")).toThrow("entry 0 has no cid")
  })

  it("rejects a pinnedAt that is not a date", () => {
    expect(() => parseDeployments(JSON.stringify([{ cid: "bafy1", tag: "v1", pinnedAt: "yesterday" }]))).toThrow(
      "entry 0 has a pinnedAt that is not a date",
    )
  })
})

describe("latestDeployment", () => {
  it("picks the latest pinnedAt, wherever it sits in the file", () => {
    const list = [
      { cid: "b", tag: "v2", pinnedAt: "2026-12-01T00:00:00Z" },
      { cid: "c", tag: "v3", pinnedAt: "2027-01-01T00:00:00Z" },
      { cid: "a", tag: "v1", pinnedAt: "2026-11-01T00:00:00Z" },
    ]
    expect(latestDeployment(list)?.cid).toBe("c")
  })

  it("is undefined for no release", () => {
    expect(latestDeployment([])).toBeUndefined()
  })
})

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
  it("writes one row per outcome and names the release checked", () => {
    const text = summary(
      [
        { target: "production", ok: true, detail: "fine" },
        { target: "https://gw.example.test", ok: false, detail: "a | b" },
      ],
      { cid: "bafy1", tag: "v1", pinnedAt: "2026-11-01" },
    )
    expect(text).toContain("| production | OK | fine |")
    expect(text).toContain("| https://gw.example.test | FAIL | a \\| b |")
    expect(text).toContain("release `v1`, `bafy1`")
  })

  it("escapes what a target served, so a detail cannot add a link, an image or a row", () => {
    const text = summary([{ target: "https://gw.example.test", ok: false, detail: 'title "![x](https://evil.test/a.png) [y](z)"\n| new | row |' }], undefined)
    expect(text).toContain('title "!\\[x\\]\\(https://evil.test/a.png\\) \\[y\\]\\(z\\)" \\| new \\| row \\|')
    expect(text.split("\n").filter((line) => line.startsWith("| https://gw.example.test"))).toHaveLength(1)
  })

  it("says IPFS was not checked when no release is recorded", () => {
    expect(summary([], undefined)).toContain("IPFS: not checked. No release is recorded in `deployments.json`.")
  })
})

describe("availability.ts", () => {
  it("refuses to run without PRODUCTION_URL, and says what is missing", () => {
    const env = { ...process.env, PRODUCTION_URL: "" }
    const run = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../availability.ts")], { env, encoding: "utf8" })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("PRODUCTION_URL is not set")
  })
})
