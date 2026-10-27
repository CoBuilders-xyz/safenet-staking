import { describe, it, expect } from "vitest"
import { gatewayHost, gatewayUrl, probeAsset, servesRelease } from "../release-gateways"

const bytes = (text: string) => new TextEncoder().encode(text)

describe("probeAsset", () => {
  const file = (path: string, size: number) => ({ path, size })

  it("picks the smallest .js file under assets/", () => {
    const files = [file("index.html", 10), file("assets/a.js", 899_000), file("assets/z.js", 1_200), file("assets/a.css", 5)]
    expect(probeAsset(files)).toBe("assets/z.js")
  })

  it("breaks a tie in size by name in byte order", () => {
    expect(probeAsset([file("assets/b.js", 100), file("assets/B.js", 100), file("assets/c.js", 200)])).toBe("assets/B.js")
  })

  it("ignores .js files outside assets/ and source maps", () => {
    const files = [file("sw.js", 1), file("assets/app.js.map", 2), file("assets/app.js", 300)]
    expect(probeAsset(files)).toBe("assets/app.js")
  })

  it("is undefined when the release holds no JavaScript under assets/", () => {
    expect(probeAsset([file("index.html", 10), file("assets/app.css", 20)])).toBeUndefined()
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
