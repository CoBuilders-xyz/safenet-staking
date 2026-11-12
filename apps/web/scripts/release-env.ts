import { parseEnv } from "node:util"

/**
 * Service URLs a release may take from the environment, so an operator can point a release at
 * new hosts, such as a later custom domain, without a code change. Both are public: they ship to
 * every visitor. In CI they come from repository variables, and the job summary records them.
 */
export const RELEASE_URL_INPUTS = ["VITE_VALIDATOR_INFO_URL", "VITE_ALERTS_API_URL"] as const
export type ReleaseUrls = Partial<Record<(typeof RELEASE_URL_INPUTS)[number], string | undefined>>

/** A plain https URL: no credentials, query or fragment. The error never repeats the value. */
function publicUrl(key: string, value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${key} must be an https URL`) }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be an https URL without credentials, query or fragment`)
  }
  return value
}

/**
 * Release inputs: committed public values, the one explicit COB-566 browser key, and the service
 * URLs. A non-empty URL from the environment wins over build.env.
 */
export function releaseEnvironment(source: string, graphApiKey?: string, urls: ReleaseUrls = {}): Record<string, string | undefined> {
  const values = parseEnv(source)
  for (const key of Object.keys(values)) {
    if (!key.startsWith("VITE_")) throw new Error("build.env must contain only VITE_ variables")
  }
  if (values.VITE_GRAPH_API_KEY) throw new Error("Inject VITE_GRAPH_API_KEY through the environment, not build.env")
  if (graphApiKey?.trim()) values.VITE_GRAPH_API_KEY = graphApiKey.trim()
  for (const key of RELEASE_URL_INPUTS) {
    const value = urls[key]?.trim()
    if (value) values[key] = value
    if (values[key]) publicUrl(key, values[key])
  }
  return values
}
