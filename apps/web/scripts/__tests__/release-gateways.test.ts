import { describe, it, expect } from "vitest"
import { gatewayHost, gatewayUrl, probeAsset, servesRelease } from "../release-gateways"

const bytes = (text: string) => new TextEncoder().encode(text)

describe("probeAsset", () => {
  it("picks the first .js file under assets/ in byte order", () => {
    const paths = ["index.html", "assets/b.js", "assets/B.js", "assets/a.css", "favicon.ico"]
    expect(probeAsset(paths)).toBe("assets/B.js")
  })

  it("ignores .js files outside assets/ and source maps", () => {
    expect(probeAsset(["sw.js", "assets/app.js.map", "assets/app.js"])).toBe("assets/app.js")
  })

  it("is undefined when the release holds no JavaScript under assets/", () => {
    expect(probeAsset(["index.html", "assets/app.css"])).toBeUndefined()
  })
})

describe("servesRelease", () => {
  const js = bytes("const a=1;export{a};\n")

  it("accepts the release's bytes", () => {
    expect(servesRelease(bytes("const a=1;export{a};\n"), js)).toBe(true)
  })

  it("rejects one changed byte and a different length", () => {
    expect(servesRelease(bytes("const a=2;export{a};\n"), js)).toBe(false)
    expect(servesRelease(bytes("const a=1;export{a};"), js)).toBe(false)
  })

  it("rejects an HTML page with a script injected, which is why index.html is not compared", () => {
    const html = "<html><head></head><body><div id=root></div></body></html>"
    const injected = html.replace("</body>", "<script>window.__CF$cv$params={}</script></body>")
    expect(servesRelease(bytes(injected), bytes(html))).toBe(false)
  })
})

describe("gatewayHost", () => {
  it("keeps only the host of a bare host, a URL, or a URL with a path", () => {
    expect(gatewayHost("pinata.example")).toBe("pinata.example")
    expect(gatewayHost(" https://pinata.example/ ")).toBe("pinata.example")
    expect(gatewayHost("pinata.example/ipfs")).toBe("pinata.example")
    expect(gatewayHost("https://pinata.example/ipfs/")).toBe("pinata.example")
  })

  it("is undefined when the value is empty or holds no host", () => {
    expect(gatewayHost(undefined)).toBeUndefined()
    expect(gatewayHost("   ")).toBeUndefined()
    expect(gatewayHost("https://")).toBeUndefined()
  })
})

describe("gatewayUrl", () => {
  it("builds a path-style URL", () => {
    expect(gatewayUrl("https://gw.example", "bafyexample", "assets/app.js")).toBe(
      "https://gw.example/ipfs/bafyexample/assets/app.js",
    )
  })
})
