import { WEBHOOK_PATH, WEBHOOK_UPDATES, usableWebhookSecret } from "./telegram.js"

/** What the operator's environment supplies. `scripts/telegram-webhook.ts` passes `process.env`. */
export type AdminEnv = Record<string, string | undefined>
/** What Telegram reports about the webhook. It holds no token and no secret. */
export interface WebhookInfo {
  url: string
  pendingUpdates: number
  allowedUpdates: string[]
  maxConnections: number | null
  lastErrorAt: string | null
  lastError: string | null
}

/** A failure the operator can act on. Its message never holds the token or the secret. */
export class AdminError extends Error {}

function token(env: AdminEnv): string {
  const value = env.TELEGRAM_BOT_TOKEN
  if (!value) throw new AdminError("TELEGRAM_BOT_TOKEN is not set")
  return value
}
/** The Worker's webhook URL, from its public origin in ALERTS_URL. */
export function webhookUrl(env: AdminEnv): string {
  const origin = env.ALERTS_URL
  if (!origin) throw new AdminError("ALERTS_URL is not set. Set it to the alerts Worker's origin, such as https://safenet-alerts.<subdomain>.workers.dev")
  let url: URL
  try { url = new URL(origin) } catch { throw new AdminError("ALERTS_URL is not a URL") }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
    throw new AdminError("ALERTS_URL must be an https origin: no path, query or credentials")
  }
  return `${url.origin}${WEBHOOK_PATH}`
}

/** One Bot API call. A failure carries Telegram's own description, with the token removed in case it is echoed. */
async function call(env: AdminEnv, method: string, body: unknown, transport: typeof fetch): Promise<unknown> {
  const secret = token(env)
  let answer: { ok?: boolean; result?: unknown; description?: unknown }
  try {
    const response = await transport(`https://api.telegram.org/bot${secret}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    })
    answer = await response.json() as typeof answer
  } catch {
    // The cause can name the request URL, which holds the token.
    throw new AdminError(`Telegram did not answer ${method}`)
  }
  if (!answer.ok) {
    const description = typeof answer.description === "string" ? answer.description.replaceAll(secret, "<token>") : "no description"
    throw new AdminError(`Telegram refused ${method}: ${description}`)
  }
  return answer.result
}

export async function webhookInfo(env: AdminEnv, transport: typeof fetch = fetch): Promise<WebhookInfo> {
  const info = await call(env, "getWebhookInfo", {}, transport) as Record<string, unknown> | null
  const text = (value: unknown) => typeof value === "string" && value ? value : null
  return {
    url: text(info?.url) ?? "",
    pendingUpdates: typeof info?.pending_update_count === "number" ? info.pending_update_count : 0,
    allowedUpdates: Array.isArray(info?.allowed_updates) ? info.allowed_updates.filter(item => typeof item === "string") : [],
    maxConnections: typeof info?.max_connections === "number" ? info.max_connections : null,
    lastErrorAt: typeof info?.last_error_date === "number" ? new Date(info.last_error_date * 1000).toISOString() : null,
    lastError: text(info?.last_error_message),
  }
}

/**
 * Registers the Worker's webhook: its URL, the secret the Worker checks on every request, and
 * only the two update kinds it reads. Updates Telegram still holds are dropped: their link codes
 * were sent while nothing listened, and the alerts page offers a new link. Then reads the
 * registration back and fails unless Telegram holds this URL.
 */
export async function setWebhook(env: AdminEnv, transport: typeof fetch = fetch): Promise<WebhookInfo> {
  const url = webhookUrl(env)
  const secret = env.TELEGRAM_WEBHOOK_SECRET
  if (!usableWebhookSecret(secret)) {
    throw new AdminError("TELEGRAM_WEBHOOK_SECRET must be 32 to 256 characters of A-Z, a-z, 0-9, _ and -. It must be the value the Worker was deployed with")
  }
  await call(env, "setWebhook", { url, secret_token: secret, allowed_updates: WEBHOOK_UPDATES, drop_pending_updates: true }, transport)
  const info = await webhookInfo(env, transport)
  if (info.url !== url) throw new AdminError("Telegram accepted setWebhook but reports another URL")
  return info
}

/**
 * Removes the webhook, so a Worker version that polls getUpdates can read again. Updates Telegram
 * still holds are kept for it.
 */
export async function deleteWebhook(env: AdminEnv, transport: typeof fetch = fetch): Promise<WebhookInfo> {
  await call(env, "deleteWebhook", { drop_pending_updates: false }, transport)
  const info = await webhookInfo(env, transport)
  if (info.url) throw new AdminError("Telegram accepted deleteWebhook but still reports a URL")
  return info
}

/** The lines the script prints. With ALERTS_URL set, the first line says whether the webhook is this Worker's. */
export function describe(info: WebhookInfo, env: AdminEnv): string[] {
  let state = info.url ? "registered" : "not registered: Telegram delivers no update"
  if (info.url && env.ALERTS_URL) state = info.url === webhookUrl(env) ? "registered for this Worker" : "registered for ANOTHER URL"
  return [
    `webhook: ${state}`,
    `url: ${info.url || "(none)"}`,
    `allowed updates: ${info.allowedUpdates.join(", ") || "(Telegram's default)"}`,
    `pending updates: ${info.pendingUpdates}`,
    `max connections: ${info.maxConnections ?? "(default)"}`,
    `last error: ${info.lastErrorAt ? `${info.lastErrorAt} ${info.lastError ?? ""}`.trim() : "(none)"}`,
  ]
}
