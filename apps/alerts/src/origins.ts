import { HttpError, type Env } from "./types.js"

const loopback = new Set(["localhost", "127.0.0.1"])

/** Normalizes one configured origin. Returns null unless it is an exact scheme, host and optional port. */
function normalize(entry: string): string | null {
  let url: URL
  try { url = new URL(entry) } catch { return null }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && loopback.has(url.hostname))
  if (!secure || entry.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
  return url.origin
}

/**
 * The exact browser origins allowed to call the API: APP_ORIGINS, a comma-separated list, merged
 * with the legacy single APP_ORIGIN. No wildcards. A malformed entry or an empty list fails closed.
 */
export function allowedOrigins(env: Pick<Env, "APP_ORIGIN" | "APP_ORIGINS">): string[] {
  const entries = [env.APP_ORIGIN ?? "", ...(env.APP_ORIGINS ?? "").split(",")].map(entry => entry.trim()).filter(Boolean)
  const origins = entries.map(normalize)
  if (!origins.length || origins.includes(null)) throw new HttpError(503, "Service unavailable")
  return [...new Set(origins as string[])]
}

/** Returns the request origin when it is allowlisted; otherwise refuses the request. */
export function allowedOrigin(env: Pick<Env, "APP_ORIGIN" | "APP_ORIGINS">, origin: string | null): string {
  if (!origin || !allowedOrigins(env).includes(origin)) throw new HttpError(403, "Origin refused")
  return origin
}
