// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { checkBundle, initialAssets, measureBundle, median, readBudget } from "../budget"

describe("initialAssets", () => {
  it("finds the module entry, the preloads and the stylesheets, and nothing lazy", () => {
    const html = `
      <script type="module" crossorigin src="./assets/index-a.js"></script>
      <link rel="modulepreload" crossorigin href="./assets/vendor-ui-b.js">
      <link rel="stylesheet" crossorigin href="./assets/index-c.css">
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <script>if (localStorage.theme === 'dark') {}</script>`
    expect(initialAssets(html)).toEqual({ js: ["assets/index-a.js", "assets/vendor-ui-b.js"], css: ["assets/index-c.css"] })
  })
})

describe("median", () => {
  it("takes the middle run, the lower one for an even count", () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([40, 10, 30, 20])).toBe(20)
  })
})

describe("measureBundle and checkBundle", () => {
  const dist = mkdtempSync(join(tmpdir(), "budget-"))
  afterAll(() => rmSync(dist, { recursive: true, force: true }))
  mkdirSync(join(dist, "assets"))
  // Random bytes do not compress, so each file's gzip size is close to its size.
  const random = (kb: number) => Buffer.from(Array.from({ length: kb * 1024 }, () => Math.floor(Math.random() * 256)))
  writeFileSync(join(dist, "index.html"), `<script type="module" src="./assets/index-a.js"></script><link rel="stylesheet" href="./assets/index-c.css">`)
  writeFileSync(join(dist, "assets/index-a.js"), random(20))
  writeFileSync(join(dist, "assets/index-c.css"), random(2))
  writeFileSync(join(dist, "assets/core-d.js"), random(40))
  writeFileSync(join(dist, "assets/OverviewPage-e.js"), random(8))
  writeFileSync(join(dist, "assets/useThing-f.js"), random(12))

  it("measures what loads first, the largest chunk and the largest page chunk", () => {
    const size = measureBundle(dist)
    expect(size.initialJsKb).toBeGreaterThan(19)
    expect(size.initialJsKb).toBeLessThan(22)
    expect(size.largestChunk).toBe("core-d.js")
    expect(size.pageChunk).toBe("OverviewPage-e.js")
  })

  it("passes within every limit and names the one exceeded", () => {
    const size = measureBundle(dist)
    expect(checkBundle(size, { initialJsKb: 30, initialCssKb: 5, largestChunkKb: 50, pageChunkKb: 10 }).every((v) => v.ok)).toBe(true)
    const over = checkBundle(size, { initialJsKb: 30, initialCssKb: 5, largestChunkKb: 50, pageChunkKb: 5 }).filter((v) => !v.ok)
    expect(over.map((v) => v.name)).toEqual(["largest page chunk (OverviewPage-e.js)"])
  })
})

describe("performance-budget.json", () => {
  it("sets every limit the checks read", () => {
    const budget = readBudget(resolve(import.meta.dirname, "../../performance-budget.json"))
    expect(Object.keys(budget.bundle).sort()).toEqual(["initialCssKb", "initialJsKb", "largestChunkKb", "pageChunkKb"])
    expect(budget.lighthouse.runs).toBeGreaterThanOrEqual(3)
    expect(budget.lighthouse.minScores.accessibility).toBe(100)
    expect(budget.lighthouse.maxMetrics["cumulative-layout-shift"]).toBeLessThanOrEqual(0.1)
  })
})
