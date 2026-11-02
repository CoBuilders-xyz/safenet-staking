/**
 * The checks behind availability.ts, with fetch passed in, so each branch is unit-tested without
 * the network. Each check returns an outcome; none throws for a target that is down.
 */
import { IPFS_GATEWAYS, ORBITOR_IPFS_GATEWAY } from "@cobuilders/safenet-core"
import { CID } from "multiformats/cid"
import { gatewayUrl } from "@cobuilders/safenet-snapshots/ipfs"

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
  httpStatus?: number
  /** A known redundant-gateway failure, after the required delivery paths passed. */
  advisory?: boolean
}

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/**
 * Parses `deployments.json`: an array of `{ "cid", "tag", "pinnedAt" }`, each a non-empty string,
 * `cid` a CID and `pinnedAt` a date. Throws naming the first entry that is not, because a malformed record would
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
    try {
      CID.parse(record.cid as string)
    } catch {
      throw new Error(`deployments.json entry ${index} has a cid that is not a CID`)
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

/** An answer read to its end: the status, the final URL, the headers and the whole body. */
interface Answer {
  status: number
  url: string
  headers: Headers
  text: string
}

/**
 * GETs a URL and reads the body inside the same try, because the timeout signal also aborts the
 * body: a 200 that stalls mid-body rejects `.text()`, and outside the try that rejection would end
 * the run with no outcome for any target. Returns the answer, or why there is none.
 */
async function get(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<Answer | string> {
  let headersArrived = false
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    headersArrived = true
    const text = await response.text()
    return { status: response.status, url: response.url, headers: response.headers, text }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError"
    if (headersArrived) {
      return timedOut
        ? `answered, but the body did not finish in ${timeoutMs / 1000} s`
        : `answered, but the body failed: ${error instanceof Error ? error.message : String(error)}`
    }
    return timedOut
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
  const html = index.text
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
  const body = script.status === 200 ? script.text : ""
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
  if (response.status !== 200) return { target, ok: false, httpStatus: response.status, detail: `answered ${response.status}` }
  const served = pageTitle(response.text)
  return served === title
    ? { target, ok: true, detail: `index.html of ${cid} answered 200 with the title` }
    : { target, ok: false, detail: `index.html of ${cid} has the title ${served === undefined ? "missing" : `"${served}"`}` }
}

/** Keep Orbitor's 504 visible, but do not page when production and every other gateway passed. */
export function applyAvailabilityPolicy(outcomes: readonly Outcome[]): Outcome[] {
  const production = outcomes.filter(o => o.target === "production")
  const requiredGateways = IPFS_GATEWAYS.filter(g => g !== ORBITOR_IPFS_GATEWAY)
  const orbitorTimeout = (o: Outcome) => o.target === ORBITOR_IPFS_GATEWAY && !o.ok && o.httpStatus === 504
  const healthyAlternatives = production.length === 2 && production.every(o => o.ok)
    && requiredGateways.length > 0 && requiredGateways.every(g => outcomes.some(o => o.target === g && o.ok))
    && outcomes.every(o => o.ok || orbitorTimeout(o))
  return outcomes.map(o => ({ ...o, advisory: healthyAlternatives && orbitorTimeout(o) }))
}

/** Emit a notice, advisory warning, or blocking error; escape Actions command syntax. */
export function annotation({ target, ok, detail, advisory }: Outcome): string {
  const escape = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
  // A property value also ends at `:` or `,`.
  const title = escape(`Availability: ${target}`).replace(/:/g, "%3A").replace(/,/g, "%2C")
  return `::${ok ? "notice" : advisory ? "warning" : "error"} title=${title}::${escape(detail)}`
}

/**
 * The job summary: one row per outcome, and a line when no release is recorded. A detail can
 * quote what a target served, so it is escaped: a parked gateway's title cannot add a link, an
 * image or a row.
 */
export function summary(outcomes: readonly Outcome[], release: Deployment | undefined): string {
  const escape = (text: string) => text.replace(/[\\|[\]()]/g, "\\$&").replace(/\r?\n|\r/g, " ")
  return [
    "## Availability",
    "",
    "| Target | Result | Detail |",
    "|---|---|---|",
    ...outcomes.map((o) => `| ${escape(o.target)} | ${o.ok ? "OK" : o.advisory ? "WARN (non-blocking)" : "FAIL"} | ${escape(o.detail)} |`),
    "",
    release
      ? `IPFS: release \`${release.tag}\`, \`${release.cid}\`, pinned ${release.pinnedAt}, from \`deployments.json\`.`
      : "IPFS: not checked. No release is recorded in `deployments.json`.",
    "",
  ].join("\n")
}
