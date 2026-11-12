export const triggers = ["cooldown", "rewards", "deregistered", "participation", "missed"] as const
export type Trigger = typeof triggers[number]
export type Channel = { kind: "telegram" } | { kind: "push"; endpoint: string; keys: { p256dh: string; auth: string } }
export interface Subscription {
  id: string
  wallet: string
  triggers: Trigger[]
  participation: number
  missed: number
  channel: Channel
  telegram_chat: string | null
  status: "unverified" | "verified" | "expired"
  last_delivery: string | null
}
type WorkerConfig = import("cf/config").UnwrapConfig<typeof import("../cloudflare.config.js").default>["worker"]
type ConfiguredEnv = import("cf/config").InferEnv<WorkerConfig>
/** Configuration-derived bindings. Providers can be absent before provisioning. */
/** APP_ORIGIN, APP_ORIGINS or both name the allowed browser origins; `allowedOrigins` requires at least one. */
export type Env = Pick<ConfiguredEnv, "DB"> & Partial<Omit<ConfiguredEnv, "DB">> & {
  /** Legacy single origin, merged with APP_ORIGINS. Optional, so not a declared (required) secret. */
  APP_ORIGIN?: string
  /** Isolated-fork dataset override. Optional, so not a declared (required) secret. */
  REWARDS_BASE_URL?: string
  /** Overrides the Mainnet subgraph URL that core derives from GRAPH_API_KEY. Optional. */
  SUBGRAPH_URL_MAINNET?: string
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid request")
  return value as Record<string, unknown>
}
export function subscriptionInput(value: unknown) {
  const v = object(value)
  if (!Array.isArray(v.triggers) || !v.triggers.length || v.triggers.length > triggers.length ||
      !v.triggers.every(t => triggers.includes(t)) || new Set(v.triggers).size !== v.triggers.length) {
    throw new HttpError(400, "Choose valid triggers")
  }
  if (typeof v.participation !== "number" || !Number.isFinite(v.participation) || v.participation < 0 || v.participation > 100 ||
      typeof v.missed !== "number" || !Number.isInteger(v.missed) || v.missed < 1 || v.missed > 1000) {
    throw new HttpError(400, "Invalid thresholds")
  }
  const c = object(v.channel)
  let channel: Channel
  if (c.kind === "telegram") channel = { kind: "telegram" }
  else if (c.kind === "push") {
    const keys = object(c.keys)
    if (typeof c.endpoint !== "string" || c.endpoint.length > 2048) throw new HttpError(400, "Invalid push endpoint")
    let url: URL
    try { url = new URL(c.endpoint) } catch { throw new HttpError(400, "Invalid push endpoint") }
    // Push providers only. An arbitrary URL would turn a signed subscription into SSRF.
    const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname === "web.push.apple.com" || url.hostname.endsWith(".notify.windows.com")
    if (!allowed || url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new HttpError(400, "Unsupported push provider")
    if (typeof keys.p256dh !== "string" || !/^[\w-]{87}$/.test(keys.p256dh) ||
        typeof keys.auth !== "string" || !/^[\w-]{22}$/.test(keys.auth)) throw new HttpError(400, "Invalid push keys")
    channel = { kind: "push", endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }
  } else throw new HttpError(400, "Invalid channel")
  return { triggers: v.triggers as Trigger[], participation: v.participation, missed: v.missed, channel }
}
