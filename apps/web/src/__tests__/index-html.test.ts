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
})
