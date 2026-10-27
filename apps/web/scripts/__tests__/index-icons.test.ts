// @vitest-environment node
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const app = resolve(import.meta.dirname, "../..")
const html = readFileSync(join(app, "index.html"), "utf8")
const manifest = JSON.parse(readFileSync(join(app, "public/manifest.json"), "utf8")) as { icons: { src: string }[] }

/** Every root-relative href a <link> in index.html points at, by its rel. */
function linkedFiles(): { rel: string; href: string }[] {
  return [...html.matchAll(/<link\b[^>]*>/g)].flatMap(([tag]) => {
    const rel = /\brel="([^"]+)"/.exec(tag)?.[1]
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1]
    return rel && href?.startsWith("/") ? [{ rel, href }] : []
  })
}

describe("the icons the page and the manifest name", () => {
  it("links at least one favicon", () => {
    expect(linkedFiles().filter((l) => l.rel === "icon").length).toBeGreaterThan(0)
  })

  it.each(linkedFiles())("$rel $href is a file in public/", ({ href }) => {
    expect(existsSync(join(app, "public", href))).toBe(true)
  })

  it.each(manifest.icons)("manifest icon $src is a file in public/", ({ src }) => {
    expect(existsSync(join(app, "public", src))).toBe(true)
  })
})
