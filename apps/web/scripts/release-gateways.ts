/**
 * Pure helpers for release-pin.ts: which file proves a gateway serves the release, how its bytes
 * are compared, and how PINATA_GATEWAY becomes a host. No network, so they are unit-tested.
 */

/**
 * The file whose bytes prove a gateway serves this release: the first `.js` file under
 * `assets/`, in byte order. Not index.html: a gateway fronted by Cloudflare injects a challenge
 * script into every text/html response, so its index.html never equals the release's. A
 * JavaScript file is served as it is stored. `paths` are relative to the release root, with `/`.
 */
export function probeAsset(paths: readonly string[]): string | undefined {
  return paths
    .filter((p) => p.startsWith("assets/") && p.endsWith(".js"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0]
}

/** True when a gateway's body is the release's file, byte for byte. */
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
