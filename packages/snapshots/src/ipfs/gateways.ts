/**
 * Proving that gateways serve a pinned CID: which file proves it, how its bytes are compared,
 * how PINATA_GATEWAY becomes a host, and the retry loop each gateway gets.
 *
 * A pin no gateway serves is not published, and a 200 with a fallback page is not a pin being
 * served. So each check fetches one file of the DAG by path and compares it byte for byte with
 * the file that was packed.
 */

/**
 * The file whose bytes prove a gateway serves the interface's release: the smallest `.js` file
 * under `assets/`, ties broken by name in byte order. Small, because a gateway fetches it from
 * the network on first request, and a large chunk drew 504s before its 200. Not index.html: a
 * gateway fronted by Cloudflare injects a challenge script into every text/html response, so
 * its index.html never equals the release's. A JavaScript file is served as it is stored.
 * Each `path` is relative to the release root, with `/`; `size` is in bytes.
 */
export function probeAsset(files: readonly { path: string; size: number }[]): string | undefined {
  return files
    .filter(({ path }) => path.startsWith("assets/") && path.endsWith(".js"))
    .sort((a, b) => a.size - b.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0]?.path
}

/** True when a gateway's body is the packed file, byte for byte. */
export function servesRelease(body: Uint8Array, expected: Uint8Array): boolean {
  if (body.length !== expected.length) return false
  for (let i = 0; i < body.length; i++) if (body[i] !== expected[i]) return false
  return true
}

/**
 * The host of the dedicated gateway in PINATA_GATEWAY, which may be a bare host or a URL. Only
 * the host counts, as packages/core does for gateways: a path such as `/ipfs` is dropped,
 * because `/ipfs/<cid>` is added later. Undefined when the value is empty or holds no host.
 */
export function gatewayHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return url.host || undefined
  } catch {
    return undefined
  }
}

/** Path-style URL: `<origin>/ipfs/<cid>/<path>`, the form every checked gateway serves. */
export function gatewayUrl(origin: string, cid: string, path: string): string {
  return `${origin}/ipfs/${cid}/${path}`
}

export interface Gateway {
  /** What the log prints. The dedicated gateway's host is a secret, so its label is not its URL. */
  readonly label: string
  readonly origin: string
}

export interface ServeCheck {
  readonly cid: string
  /** A path that must answer 200 before the probe is fetched, such as the release's index.html. */
  readonly ready?: string
  /** The path whose bytes are compared. */
  readonly probe: string
  readonly expected: Uint8Array
  readonly timeoutMs: number
  /** Pause between attempts. */
  readonly retryMs?: number
  /** Takes every secret out of an error message. */
  readonly redact: (err: unknown) => string
  readonly log: (line: string) => void
  /** For tests. */
  readonly fetch?: typeof fetch
}

export interface Outcome {
  readonly label: string
  readonly ok: boolean
  readonly detail: string
}

/** One gateway, retried until it serves the probe's bytes or the time runs out. */
export async function waitUntilServed(gateway: Gateway, check: ServeCheck): Promise<Outcome> {
  const { label, origin } = gateway
  const { cid, ready, probe, expected, timeoutMs, redact, log } = check
  const get = check.fetch ?? fetch
  const retryMs = check.retryMs ?? 15_000
  const deadline = Date.now() + timeoutMs
  let last = "no answer"
  for (let attempt = 1; ; attempt++) {
    try {
      const readyStatus = ready ? await status(get, gatewayUrl(origin, cid, ready)) : 200
      if (readyStatus !== 200) {
        last = `${ready}: HTTP ${readyStatus}`
      } else {
        const res = await get(gatewayUrl(origin, cid, probe), { redirect: "follow", signal: AbortSignal.timeout(60_000) })
        if (res.status === 200) {
          // The path is immutable: a 200 with other bytes will not get better with retries.
          if (!servesRelease(new Uint8Array(await res.arrayBuffer()), expected)) {
            return { label, ok: false, detail: `answered 200 for ${probe} with bytes that are not the ones pinned` }
          }
          const readyNote = ready ? `${ready} 200, ` : ""
          return { label, ok: true, detail: `${readyNote}${probe} identical to the pinned file (attempt ${attempt})` }
        }
        await res.body?.cancel().catch(() => {})
        last = `${probe}: HTTP ${res.status}`
      }
    } catch (err) {
      last = redact(err)
    }
    if (Date.now() + retryMs > deadline) {
      return { label, ok: false, detail: `not served within ${timeoutMs / 1000} s. Last: ${last}` }
    }
    log(`${label}: ${last}, retrying in ${retryMs / 1000} s`)
    await new Promise((r) => setTimeout(r, retryMs))
  }
}

/** One fetch, bounded, whose body is dropped unread. A body that errors is not an answer error. */
async function status(get: typeof fetch, url: string): Promise<number> {
  const res = await get(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) })
  await res.body?.cancel().catch(() => {})
  return res.status
}

/**
 * Every gateway checked to the end, so the log shows whether the dedicated gateway served the
 * CID when a public one did not.
 */
export async function checkGateways(gateways: readonly Gateway[], check: ServeCheck): Promise<Outcome[]> {
  const settled = await Promise.allSettled(gateways.map((g) => waitUntilServed(g, check)))
  return settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : { label: gateways[i]!.label, ok: false, detail: `check crashed: ${check.redact(result.reason)}` },
  )
}
