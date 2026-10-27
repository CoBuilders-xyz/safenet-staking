/**
 * The checks behind availability.ts, with fetch passed in, so each branch is unit-tested without
 * the network. Each check returns an outcome; none throws for a target that is down.
 */
import { gatewayUrl } from "./release-gateways"

/** One pinned release, as `deployments.json` at the repository root records it. */
export interface Deployment {
  cid: string
  tag: string
  /** ISO 8601. */
  pinnedAt: string
}

export interface Outcome {
  /** What was checked, as printed: "production", or a gateway's origin. */
  target: string
  ok: boolean
  detail: string
}

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/**
 * Parses `deployments.json`: an array of `{ "cid", "tag", "pinnedAt" }`, each a non-empty string,
 * `pinnedAt` a date. Throws naming the first entry that is not, because a malformed record would
 * otherwise check the wrong release, or none, and pass.
 */
export function parseDeployments(text: string): Deployment[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("deployments.json is not JSON")
  }
  if (!Array.isArray(value)) throw new Error("deployments.json is not an array")
  return value.map((entry: unknown, index) => {
    const record = (entry ?? {}) as Record<string, unknown>
    for (const field of ["cid", "tag", "pinnedAt"] as const) {
      if (typeof record[field] !== "string" || (record[field] as string).trim() === "") {
        throw new Error(`deployments.json entry ${index} has no ${field}`)
      }
    }
    if (Number.isNaN(Date.parse(record.pinnedAt as string))) {
      throw new Error(`deployments.json entry ${index} has a pinnedAt that is not a date`)
    }
    return { cid: record.cid as string, tag: record.tag as string, pinnedAt: record.pinnedAt as string }
  })
}

/** The release pinned last, by `pinnedAt`, not by its place in the file. Undefined when empty. */
export function latestDeployment(deployments: readonly Deployment[]): Deployment | undefined {
  return deployments.reduce<Deployment | undefined>(
    (latest, d) => (!latest || Date.parse(d.pinnedAt) > Date.parse(latest.pinnedAt) ? d : latest),
    undefined,
  )
}

/** The text of the first `<title>`, trimmed. Undefined when the page has none. */
export function pageTitle(html: string): string | undefined {
  return /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim()
}

/**
 * The entry script of a Vite build, the `src` of the `<script type="module">` under `assets/`.
 * Undefined in the source `index.html`, whose entry is `/src/main.tsx`, and in a page without one.
 */
export function entryAsset(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(tag)) continue
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]
    if (src && /(^|\/)assets\/[^/]+\.js$/.test(src)) return src
  }
  return undefined
}

async function get(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<Response | string> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return error instanceof Error && error.name === "TimeoutError"
      ? `no answer in ${timeoutMs / 1000} s`
      : `request failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * The production deployment: its index answers 200 with the expected title, and the entry script
 * that index names answers 200 as JavaScript. The script proves the index and its assets come
 * from the same build: an index whose assets are gone renders a blank page with a 200.
 */
export async function checkProduction(fetchImpl: Fetch, baseUrl: string, title: string, timeoutMs = 30_000): Promise<Outcome[]> {
  const target = "production"
  const index = await get(fetchImpl, baseUrl, timeoutMs)
  if (typeof index === "string") return [{ target, ok: false, detail: `index: ${index}` }]
  if (index.status !== 200) return [{ target, ok: false, detail: `index answered ${index.status}` }]
  const html = await index.text()
  const served = pageTitle(html)
  const outcomes: Outcome[] = [
    served === title
      ? { target, ok: true, detail: `index answered 200 with the title "${title}"` }
      : { target, ok: false, detail: `index title is ${served === undefined ? "missing" : `"${served}"`}, expected "${title}"` },
  ]

  const asset = entryAsset(html)
  if (!asset) return [...outcomes, { target, ok: false, detail: "index names no entry script under assets/" }]
  const assetUrl = new URL(asset, index.url || baseUrl).href
  const script = await get(fetchImpl, assetUrl, timeoutMs)
  if (typeof script === "string") return [...outcomes, { target, ok: false, detail: `${asset}: ${script}` }]
  const type = script.headers.get("content-type") ?? ""
  const body = script.status === 200 ? await script.text() : ""
  outcomes.push(
    script.status === 200 && /javascript/i.test(type) && body.length > 0
      ? { target, ok: true, detail: `${asset} answered 200 as JavaScript, ${body.length} bytes` }
      : { target, ok: false, detail: `${asset} answered ${script.status} as "${type}", ${body.length} bytes` },
  )
  return outcomes
}

/**
 * One gateway serves `index.html` of the release: 200 and the expected title. Only the title,
 * not the bytes: a gateway fronted by Cloudflare injects a script into every HTML response.
 */
export async function checkGateway(fetchImpl: Fetch, gateway: string, cid: string, title: string, timeoutMs = 60_000): Promise<Outcome> {
  const target = gateway
  const response = await get(fetchImpl, gatewayUrl(gateway, cid, "index.html"), timeoutMs)
  if (typeof response === "string") return { target, ok: false, detail: response }
  if (response.status !== 200) return { target, ok: false, detail: `answered ${response.status}` }
  const served = pageTitle(await response.text())
  return served === title
    ? { target, ok: true, detail: `index.html of ${cid} answered 200 with the title` }
    : { target, ok: false, detail: `index.html of ${cid} has the title ${served === undefined ? "missing" : `"${served}"`}` }
}

/** The job summary: one row per outcome, and a line when no release is recorded. */
export function summary(outcomes: readonly Outcome[], release: Deployment | undefined): string {
  const escape = (text: string) => text.replace(/\|/g, "\\|")
  return [
    "## Availability",
    "",
    "| Target | Result | Detail |",
    "|---|---|---|",
    ...outcomes.map((o) => `| ${escape(o.target)} | ${o.ok ? "OK" : "FAIL"} | ${escape(o.detail)} |`),
    "",
    release
      ? `IPFS: release \`${release.tag}\`, \`${release.cid}\`, pinned ${release.pinnedAt}, from \`deployments.json\`.`
      : "IPFS: not checked. No release is recorded in `deployments.json`.",
    "",
  ].join("\n")
}
