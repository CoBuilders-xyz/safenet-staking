import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { GEO_LOOKUPS } from "@cobuilders/safenet-core"
import { CONTENT_PAGES, contentPageAt } from "@/config/legal"

/**
 * index.html connects early to the location service, except on the legal pages, which open
 * without the country lookup. Its script cannot import the list of those pages, so this holds
 * the script to it.
 */
const html = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8")
const guard = /if \(!(\/.+\/i)\.test\(location\.hash\)\)/.exec(html)?.[1]

describe("index.html", () => {
  it("has no unconditional preconnect to a location service", () => {
    expect(html).not.toMatch(/<link[^>]+rel="preconnect"/)
    expect(html).toContain(`preconnect.href = '${new URL(GEO_LOOKUPS[0]!.url).origin}'`)
  })

  it("skips the preconnect on exactly the pages that open without the access checks", () => {
    expect(guard).toBeDefined()
    const isLegal = new RegExp(guard!.slice(1, guard!.lastIndexOf("/")), "i")
    const hashes = [
      ...CONTENT_PAGES.flatMap((page) => [`#/${page}`, `#/${page}/`, `#/${page.toUpperCase()}`, `#/${page}?x=1`]),
      "", "#/", "#/dashboard", "#/validators", "#/terms/more", "#/privacy-policy", "#/x/faq",
    ]
    for (const hash of hashes) {
      const pathname = hash.replace(/^#/, "").split("?")[0] || "/"
      expect(isLegal.test(hash), hash).toBe(contentPageAt(pathname) !== undefined)
    }
  })

  it("describes the interface in neutral words, with no promise of rewards", () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../public/manifest.json"), "utf8")) as { description: string }
    const descriptions = [...html.matchAll(/<meta (?:name|property)="(?:description|og:description|twitter:description)" content="([^"]+)"/g)].map((m) => m[1])

    expect(descriptions).toHaveLength(3)
    for (const text of [...descriptions, manifest.description]) {
      expect(text).toBe("Non-custodial interface to the Safenet staking contracts.")
    }
  })

  it("describes the preview image by the neutral text it carries", () => {
    const alts = [...html.matchAll(/<meta (?:name|property)="(?:og:image:alt|twitter:image:alt)" content="([^"]+)"/g)].map((m) => m[1])

    expect(alts).toEqual(Array(2).fill("Safenet staking: non-custodial interface to the Safenet staking contracts"))
    expect(html).not.toMatch(/earn rewards/i)
  })
})
