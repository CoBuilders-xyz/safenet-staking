/**
 * The performance budget: its numbers, read from performance-budget.json, and the checks of a
 * built dist/ against them. No I/O beyond reading the files it is pointed at, so the tests run
 * it on a fixture. `PERFORMANCE.md` explains each number.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

export interface Budget {
  bundle: {
    /** The entry script and every chunk index.html preloads, gzipped: what a first visit downloads before anything renders. */
    initialJsKb: number
    /** Every stylesheet index.html links, gzipped. */
    initialCssKb: number
    /** The largest JavaScript file in dist, gzipped, wherever it loads. */
    largestChunkKb: number
    /** The largest page chunk, gzipped. A page loads its chunk after the entry. */
    pageChunkKb: number
  }
  lighthouse: {
    routes: string[]
    runs: number
    /** Each category's score, 0 to 100, as the median of the runs. */
    minScores: Record<string, number>
    /** Each metric's median value, in Lighthouse's unit: milliseconds, and unitless for layout shift. */
    maxMetrics: Record<string, number>
  }
}

export function readBudget(path: string): Budget {
  return JSON.parse(readFileSync(path, "utf8")) as Budget
}

export interface BundleSize {
  initialJsKb: number
  initialCssKb: number
  largestChunkKb: number
  largestChunk: string
  pageChunkKb: number
  pageChunk: string
}

const gzipKb = (bytes: Buffer) => gzipSync(bytes, { level: 9 }).length / 1024

/** The file paths an index.html loads before anything renders: its module script, preloads and stylesheets. */
export function initialAssets(html: string): { js: string[]; css: string[] } {
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1]
  const tags = html.match(/<(script|link)\b[^>]*>/g) ?? []
  const js: string[] = []
  const css: string[] = []
  for (const tag of tags) {
    if (tag.startsWith("<script") && attr(tag, "type") === "module") {
      const src = attr(tag, "src")
      if (src) js.push(src)
    } else if (attr(tag, "rel") === "modulepreload") {
      const href = attr(tag, "href")
      if (href) js.push(href)
    } else if (attr(tag, "rel") === "stylesheet") {
      const href = attr(tag, "href")
      if (href) css.push(href)
    }
  }
  const local = (p: string) => p.replace(/^\.?\//, "")
  return { js: js.map(local), css: css.map(local) }
}

/** Page chunks are named after the page modules in src/pages, which Rollup keeps as chunk names. */
const PAGE_CHUNK = /^[A-Z][A-Za-z]*Page-[\w-]+\.js$/

export function measureBundle(dist: string): BundleSize {
  const html = readFileSync(join(dist, "index.html"), "utf8")
  const { js, css } = initialAssets(html)
  const size = (p: string) => gzipKb(readFileSync(join(dist, p)))
  const scripts = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"))
  const sized = scripts.map((f) => ({ file: f, kb: size(join("assets", f)) })).sort((a, b) => b.kb - a.kb)
  const pages = sized.filter((s) => PAGE_CHUNK.test(s.file))
  return {
    initialJsKb: js.reduce((sum, p) => sum + size(p), 0),
    initialCssKb: css.reduce((sum, p) => sum + size(p), 0),
    largestChunkKb: sized[0]?.kb ?? 0,
    largestChunk: sized[0]?.file ?? "",
    pageChunkKb: pages[0]?.kb ?? 0,
    pageChunk: pages[0]?.file ?? "",
  }
}

/** One line per limit: the measured value, the limit, and whether it holds. */
export interface Verdict {
  name: string
  measured: number
  limit: number
  unit: string
  ok: boolean
}

export function checkBundle(size: BundleSize, budget: Budget["bundle"]): Verdict[] {
  const kb = (name: keyof Budget["bundle"], label: string): Verdict => ({
    name: label,
    measured: size[name],
    limit: budget[name],
    unit: "KB gzip",
    ok: size[name] <= budget[name],
  })
  return [
    kb("initialJsKb", "initial JavaScript"),
    kb("initialCssKb", "initial CSS"),
    kb("largestChunkKb", `largest chunk (${size.largestChunk})`),
    kb("pageChunkKb", `largest page chunk (${size.pageChunk})`),
  ]
}

/** The middle value; for an even count, the lower of the two middle ones. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN
}

export function formatVerdicts(verdicts: Verdict[]): string {
  return verdicts
    .map((v) => `  ${v.ok ? "ok  " : "OVER"}  ${v.name.padEnd(48)} ${v.measured.toFixed(v.unit === "" ? 3 : 1).padStart(8)} ${v.unit.padEnd(8)} limit ${v.limit}`)
    .join("\n")
}
