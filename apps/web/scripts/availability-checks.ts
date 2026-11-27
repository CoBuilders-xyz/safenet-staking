/**
 * The checks behind availability.ts, with fetch passed in, so each branch is unit-tested without
 * the network. Each check returns an outcome; none throws for a target that is down.
 */
import { IPFS_GATEWAYS, ORBITOR_IPFS_GATEWAY } from "@cobuilders/safenet-core"
import { CID } from "multiformats/cid"
import { gatewayUrl } from "@cobuilders/safenet-snapshots/ipfs"

export interface Outcome {
  /** What was checked, as printed: "production", "ENS", "API", "alerts", or a gateway's origin. */
  target: string
  ok: boolean
  detail: string
  httpStatus?: number
  /** A known redundant-gateway failure, after the required delivery paths passed. */
  advisory?: boolean
}

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/** The origin through which the ENS name serves the web release: eth.limo, from the name in core. */
export function ensOrigin(name: string): string {
  return `https://${name}.limo/`
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
 * The ENS name, through eth.limo: its index answers 200 with the title, the `x-ipfs-roots` header
 * names the root CID it serves, and that index is byte for byte the one production serves. A
 * release moves both origins to one build, so a difference means one of them is on another
 * release. Returns the CID, for the gateways to check, or undefined when the header names none.
 */
export async function checkEns(
  fetchImpl: Fetch, ensUrl: string, productionUrl: string, title: string, timeoutMs = 60_000,
): Promise<{ outcomes: Outcome[]; cid?: string }> {
  const target = "ENS"
  const index = await get(fetchImpl, ensUrl, timeoutMs)
  if (typeof index === "string") return { outcomes: [{ target, ok: false, detail: `index: ${index}` }] }
  if (index.status !== 200) return { outcomes: [{ target, ok: false, detail: `index answered ${index.status}` }] }
  const served = pageTitle(index.text)
  const outcomes: Outcome[] = [
    served === title
      ? { target, ok: true, detail: `index answered 200 with the title "${title}"` }
      : { target, ok: false, detail: `index title is ${served === undefined ? "missing" : `"${served}"`}, expected "${title}"` },
  ]
  const root = index.headers.get("x-ipfs-roots")?.split(",")[0]?.trim()
  let cid: string | undefined
  try {
    cid = root ? CID.parse(root).toString() : undefined
  } catch {
    cid = undefined
  }
  outcomes.push(
    cid
      ? { target, ok: true, detail: `serves ${cid}` }
      : { target, ok: false, detail: root ? `x-ipfs-roots names "${root}", which is not a CID` : "names no root CID in x-ipfs-roots" },
  )
  const production = await get(fetchImpl, productionUrl, timeoutMs)
  if (typeof production === "string" || production.status !== 200) {
    outcomes.push({ target, ok: false, detail: "not compared with production: production did not answer 200" })
  } else if (production.text === index.text) {
    outcomes.push({ target, ok: true, detail: "serves the same index.html as production" })
  } else {
    const name = (html: string) => entryAsset(html) ?? "no entry script"
    outcomes.push({
      target, ok: false,
      detail: `serves another index.html than production: ENS names ${name(index.text)}, production ${name(production.text)}. The two origins are on different releases`,
    })
  }
  return { outcomes, cid }
}

/** Reads a JSON answer: 200 and a body that parses. Returns the value, or why there is none. */
async function getJson(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<{ value: unknown } | string> {
  const answer = await get(fetchImpl, url, timeoutMs)
  if (typeof answer === "string") return answer
  if (answer.status !== 200) return `answered ${answer.status}`
  try {
    return { value: JSON.parse(answer.text) as unknown }
  } catch {
    return "answered 200 with a body that is not JSON"
  }
}

/**
 * The validator API, from the URL of its validator list: `/v1/health` reports `"status": "ok"`,
 * and the list is a non-empty array.
 */
export async function checkApi(fetchImpl: Fetch, validatorsUrl: string, timeoutMs = 30_000): Promise<Outcome[]> {
  const target = "API"
  const health = await getJson(fetchImpl, new URL("/v1/health", validatorsUrl).href, timeoutMs)
  const status = typeof health === "string" ? undefined : (health.value as { status?: unknown } | null)?.status
  const list = await getJson(fetchImpl, validatorsUrl, timeoutMs)
  const length = typeof list !== "string" && Array.isArray(list.value) ? list.value.length : undefined
  return [
    typeof health === "string"
      ? { target, ok: false, detail: `/v1/health ${health}` }
      : status === "ok"
        ? { target, ok: true, detail: '/v1/health answered 200 with status "ok"' }
        : { target, ok: false, detail: `/v1/health answered 200 with status ${JSON.stringify(status ?? null)}` },
    typeof list === "string"
      ? { target, ok: false, detail: `validators ${list}` }
      : length
        ? { target, ok: true, detail: `validators answered 200 with ${length} entries` }
        : { target, ok: false, detail: length === 0 ? "validators answered 200 with an empty list" : "validators answered 200 with a body that is not a list" },
  ]
}

/** The alerts Worker: `/health` answers 200 with `"healthy": true`. */
export async function checkAlerts(fetchImpl: Fetch, alertsUrl: string, timeoutMs = 30_000): Promise<Outcome> {
  const target = "alerts"
  const health = await getJson(fetchImpl, new URL("/health", alertsUrl).href, timeoutMs)
  if (typeof health === "string") return { target, ok: false, detail: `/health ${health}` }
  return (health.value as { healthy?: unknown } | null)?.healthy === true
    ? { target, ok: true, detail: "/health answered 200 with healthy true" }
    : { target, ok: false, detail: "/health answered 200 without healthy true" }
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
 * The job summary: one row per outcome, and the CID the gateways were checked for. A detail can
 * quote what a target served, so it is escaped: a parked gateway's title cannot add a link, an
 * image or a row.
 */
export function summary(outcomes: readonly Outcome[], cid: string | undefined): string {
  const escape = (text: string) => text.replace(/[\\|[\]()]/g, "\\$&").replace(/\r?\n|\r/g, " ")
  return [
    "## Availability",
    "",
    "| Target | Result | Detail |",
    "|---|---|---|",
    ...outcomes.map((o) => `| ${escape(o.target)} | ${o.ok ? "OK" : o.advisory ? "WARN (non-blocking)" : "FAIL"} | ${escape(o.detail)} |`),
    "",
    cid
      ? `IPFS: the gateways were checked for \`${cid}\`, the CID the ENS name serves.`
      : "IPFS: not checked. The ENS name served no CID.",
    "",
  ].join("\n")
}
