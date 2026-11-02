import assert from "node:assert/strict"
import { describe, it, test } from "node:test"
import { checkGateways, gatewayHost, gatewayUrl, probeAsset, servesRelease, waitUntilServed, type ServeCheck } from "./gateways.js"
import { pinataCredentials } from "./pin.js"

const bytes = (text: string) => new TextEncoder().encode(text)

describe("probeAsset", () => {
  const file = (path: string, size: number) => ({ path, size })

  it("picks the smallest .js file under assets/", () => {
    const files = [file("index.html", 10), file("assets/a.js", 899_000), file("assets/z.js", 1_200), file("assets/a.css", 5)]
    assert.equal(probeAsset(files), "assets/z.js")
  })

  it("breaks a tie in size by name in byte order", () => {
    assert.equal(probeAsset([file("assets/b.js", 100), file("assets/B.js", 100), file("assets/c.js", 200)]), "assets/B.js")
  })

  it("ignores .js files outside assets/ and source maps", () => {
    const files = [file("sw.js", 1), file("assets/app.js.map", 2), file("assets/app.js", 300)]
    assert.equal(probeAsset(files), "assets/app.js")
  })

  it("is undefined when the release holds no JavaScript under assets/", () => {
    assert.equal(probeAsset([file("index.html", 10), file("assets/app.css", 20)]), undefined)
  })
})

describe("servesRelease", () => {
  const js = bytes("const a=1;export{a};\n")

  it("accepts the release's bytes", () => {
    assert.equal(servesRelease(bytes("const a=1;export{a};\n"), js), true)
  })

  it("rejects one changed byte and a different length", () => {
    assert.equal(servesRelease(bytes("const a=2;export{a};\n"), js), false)
    assert.equal(servesRelease(bytes("const a=1;export{a};"), js), false)
  })

  it("rejects an HTML page with a script injected, which is why index.html is not compared", () => {
    const html = "<html><head></head><body><div id=root></div></body></html>"
    const injected = html.replace("</body>", "<script>window.__CF$cv$params={}</script></body>")
    assert.equal(servesRelease(bytes(injected), bytes(html)), false)
  })
})

describe("gatewayHost", () => {
  it("keeps only the host of a bare host, a URL, or a URL with a path", () => {
    assert.equal(gatewayHost("pinata.example"), "pinata.example")
    assert.equal(gatewayHost(" https://pinata.example/ "), "pinata.example")
    assert.equal(gatewayHost("pinata.example/ipfs"), "pinata.example")
    assert.equal(gatewayHost("https://pinata.example/ipfs/"), "pinata.example")
  })

  it("is undefined when the value is empty or holds no host", () => {
    assert.equal(gatewayHost(undefined), undefined)
    assert.equal(gatewayHost("   "), undefined)
    assert.equal(gatewayHost("https://"), undefined)
  })
})

test("gatewayUrl builds a path-style URL", () => {
  assert.equal(gatewayUrl("https://gw.example", "bafyexample", "assets/app.js"), "https://gw.example/ipfs/bafyexample/assets/app.js")
})

describe("waitUntilServed", () => {
  const expected = bytes('{"day":"2026-10-27"}\n')
  const check = (fetcher: typeof fetch, over: Partial<ServeCheck> = {}): ServeCheck => ({
    cid: "bafyexample", probe: "manifest.json", expected, timeoutMs: 50, retryMs: 10,
    redact: (e) => String(e), log: () => {}, fetch: fetcher, ...over,
  })
  const gw = { label: "https://gw.example", origin: "https://gw.example" }

  it("passes on the pinned bytes, after retrying a gateway that is still fetching", async () => {
    let n = 0
    const fetcher = (async () => (++n < 2 ? new Response("", { status: 504 }) : new Response(expected))) as typeof fetch
    const outcome = await waitUntilServed(gw, check(fetcher, { timeoutMs: 1_000 }))
    assert.equal(outcome.ok, true)
    assert.match(outcome.detail, /identical to the pinned file \(attempt 2\)/)
  })

  it("fails at once on a 200 with other bytes, which retrying cannot fix", async () => {
    const fetcher = (async () => new Response("<html>fallback</html>")) as typeof fetch
    const outcome = await waitUntilServed(gw, check(fetcher))
    assert.equal(outcome.ok, false)
    assert.match(outcome.detail, /not the ones pinned/)
  })

  it("asks for the ready path first when one is given", async () => {
    const urls: string[] = []
    const fetcher = (async (url: string) => {
      urls.push(url)
      return new Response(url.endsWith("index.html") ? "x" : expected)
    }) as typeof fetch
    await waitUntilServed(gw, check(fetcher, { ready: "index.html" }))
    assert.deepEqual(urls, ["https://gw.example/ipfs/bafyexample/index.html", "https://gw.example/ipfs/bafyexample/manifest.json"])
  })

  it("gives up when the time runs out, naming the last answer", async () => {
    const fetcher = (async () => new Response("", { status: 429 })) as typeof fetch
    const outcome = await waitUntilServed(gw, check(fetcher))
    assert.equal(outcome.ok, false)
    assert.match(outcome.detail, /not served within 0\.05 s\. Last: manifest\.json: HTTP 429/)
  })

  it("checks every gateway to the end", async () => {
    const fetcher = (async (url: string) => (url.startsWith("https://a.") ? new Response(expected) : new Response("", { status: 502 }))) as typeof fetch
    const outcomes = await checkGateways(
      [{ label: "a", origin: "https://a.example" }, { label: "b", origin: "https://b.example" }],
      check(fetcher),
    )
    assert.deepEqual(outcomes.map((o) => [o.label, o.ok]), [["a", true], ["b", false]])
  })
})

describe("pinataCredentials", () => {
  it("names each missing secret", () => {
    assert.equal(pinataCredentials({}), "PINATA_JWT and PINATA_GATEWAY are empty")
    assert.equal(pinataCredentials({ PINATA_JWT: "j" }), "PINATA_GATEWAY is empty")
  })

  it("takes the JWT and the gateway host out of every message", () => {
    const c = pinataCredentials({ PINATA_JWT: "secret-jwt", PINATA_GATEWAY: "https://gw.secret.example/ipfs" })
    if (typeof c === "string") throw new Error(c)
    assert.equal(c.gateway, "gw.secret.example")
    const err = new Error("fetch failed for gw.secret.example with secret-jwt", { cause: new Error("ENOTFOUND gw.secret.example") })
    assert.equal(c.redact(err), "fetch failed for <gateway> with <jwt> (ENOTFOUND <gateway>)")
  })
})
