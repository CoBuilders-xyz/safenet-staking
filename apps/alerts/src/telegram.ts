import { timingSafeEqual } from "node:crypto"
import { Database, digest } from "./db.js"
import { allowedOrigins } from "./origins.js"
import type { Env } from "./types.js"

/** Where Telegram posts updates. `scripts/telegram-webhook.ts` registers this path with setWebhook. */
export const WEBHOOK_PATH = "/telegram/webhook"
/** The only update kinds the Worker asks Telegram for. */
export const WEBHOOK_UPDATES = ["message", "callback_query"] as const
/**
 * Telegram allows 1 to 256 characters of A-Z, a-z, 0-9, _ and - in a webhook secret. The Worker
 * asks for at least 32, so a short or malformed value is treated as no secret at all.
 */
const SECRET_FORMAT = /^[\w-]{32,256}$/
export const usableWebhookSecret = (secret: string | undefined): secret is string => !!secret && SECRET_FORMAT.test(secret)
/** Telegram subscriptions need the bot, its name and the webhook secret: without the last one no /start arrives. */
export const telegramReady = (env: Env): boolean =>
  !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_BOT_NAME && usableWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET)

/** An update is a /start or a button press: a few kilobytes. Anything larger is not for this bot. */
const MAX_UPDATE_BYTES = 64_000
/** All Telegram calls of one update together, so Telegram gets its answer well inside its own timeout. */
const REPLY_BUDGET = 8000
const RECEIPT_NOTE = "Receipt confirmed."

type Json = Record<string, unknown>
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined
/** The chat's ID when it is a private chat. A code sent in a group would bind the group, and a reply there reaches every member. */
function privateChat(value: unknown): number | undefined {
  const chat = record(value)
  return chat && chat.type === "private" && typeof chat.id === "number" && Number.isSafeInteger(chat.id) && chat.id > 0 ? chat.id : undefined
}

export type StartCommand = { kind: "code"; code: string } | { kind: "bare" } | { kind: "invalid" }
/**
 * Reads `/start`, `/start <code>` and `/start@<bot> <code>`, in any case and with any whitespace.
 * Null for other text, and for a command addressed to another bot. A code is 43 URL-safe characters.
 */
export function parseStart(text: string, botName?: string): StartCommand | null {
  const match = /^\/start(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  if (match[1] && botName && match[1].toLowerCase() !== botName.toLowerCase()) return null
  const argument = (match[2] ?? "").trim()
  if (!argument) return { kind: "bare" }
  return /^[\w-]{43}$/.test(argument) ? { kind: "code", code: argument } : { kind: "invalid" }
}

/** Compares in constant time. Both values are hashed first, so neither length nor content shows in the timing. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  return timingSafeEqual(new Uint8Array(a!), new Uint8Array(b!))
}

/** The update as an object with a usable `update_id`. Undefined for an oversized or malformed body. */
async function readUpdate(request: Request): Promise<(Json & { update_id: number }) | undefined> {
  if (!request.body) return
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_UPDATE_BYTES) { await reader.cancel(); return }
    chunks.push(value)
  }
  let update: Json | undefined
  try { update = record(JSON.parse(Buffer.concat(chunks).toString())) } catch { return }
  return update && typeof update.update_id === "number" && Number.isSafeInteger(update.update_id) && update.update_id >= 0
    ? update as Json & { update_id: number } : undefined
}

/** What one update came to. Aggregate only: no chat, code or text. */
export type UpdateOutcome = "linked" | "already_linked" | "start_bare" | "start_rejected"
  | "receipt" | "receipt_repeated" | "receipt_refused" | "ignored"
export interface UpdateResult { outcome: UpdateOutcome; replyFailed: boolean }

/**
 * Handles one update: a `/start` in a private chat, or a press of "Confirm receipt". Every such
 * update gets its answer in this same request. A reply is best effort: a failed one never undoes
 * a link or a receipt, and the alerts page shows the state either way.
 */
export async function handleUpdate(db: Database, env: Env, update: Json, transport: typeof fetch = fetch): Promise<UpdateResult> {
  const deadline = Date.now() + REPLY_BUDGET
  let replyFailed = false
  const call = async (method: string, body: unknown) => {
    const left = deadline - Date.now()
    if (left <= 0) { replyFailed = true; return }
    try {
      const response = await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(Math.min(left, 5000)), body: JSON.stringify(body),
      })
      if (!response.ok) replyFailed = true
      await response.body?.cancel()
    } catch { replyFailed = true /* Never log provider URLs or bodies. */ }
  }

  const message = record(update.message)
  if (message) {
    const chat = privateChat(message.chat)
    const start = chat !== undefined && typeof message.text === "string" && message.text.length <= 4096
      ? parseStart(message.text, env.TELEGRAM_BOT_NAME) : null
    if (chat === undefined || !start) return { outcome: "ignored", replyFailed }
    const id = String(chat)
    const send = (text: string) => call("sendMessage", { chat_id: chat, text, disable_web_page_preview: true })
    // The key of this chat's reply allowance. Hashed with the webhook secret, so the table holds no chat ID.
    const allowed = async () => db.allowReply(await digest(`${env.TELEGRAM_WEBHOOK_SECRET}:${id}`))
    if (start.kind === "code") {
      const hash = await digest(start.code)
      const sentAt = typeof message.date === "number" && Number.isFinite(message.date) ? message.date * 1000 : undefined
      if (await db.linkTelegram(hash, id, sentAt)) {
        // A valid code is single use, so this confirmation needs no allowance.
        await send("Linked. Safenet alerts for this subscription will arrive in this chat. Return to the Alerts page you came from: it shows the connection, and can send a test notification.")
        return { outcome: "linked", replyFailed }
      }
      // The same link opened twice, or Telegram's client sending /start again: not an error for this chat.
      if (await db.linkedWith(hash, id)) {
        if (await allowed()) await send("Already linked. Safenet alerts for this subscription arrive in this chat.")
        return { outcome: "already_linked", replyFailed }
      }
    }
    const reason = start.kind === "bare" ? "bare" : "rejected"
    if (await allowed()) {
      let page: string | undefined
      try { page = `${allowedOrigins(env)[0]}/#/alerts` } catch { /* The reply then names the page without a link. */ }
      const where = page ? `Open ${page}` : "Open the Alerts page of Safenet"
      const manage = page ? `Manage them at ${page}` : "Manage them on the Alerts page of Safenet"
      // What a chat is told depends only on the code's outcome and on that chat's own state. An
      // unknown, expired or reused code gets one neutral reply, so the bot reveals nothing about codes.
      // A chat that already receives alerts is not told to subscribe: the page shows it as connected.
      const guidance = {
        bare: `This bot sends Safenet alerts. ${where}, subscribe with Telegram, and use the link it shows. The link opens this chat with a one-time code.`,
        rejected: `This link has expired or was already used. ${where} and press "Get a new Telegram link".`,
        bareLinked: `This chat is linked to Safenet alerts. ${manage}.`,
        rejectedLinked: `This link has expired or was already used. This chat is already linked to Safenet alerts. ${manage}. For a subscription that is not connected yet, press "Get a new Telegram link" there.`,
      }
      await send(guidance[await db.chatLinked(id) ? `${reason}Linked` as const : reason])
    }
    return { outcome: reason === "bare" ? "start_bare" : "start_rejected", replyFailed }
  }

  const callback = record(update.callback_query)
  if (callback && typeof callback.id === "string" && callback.id.length <= 256) {
    const source = record(callback.message)
    const chat = source ? privateChat(source.chat) : undefined
    let received = false, confirmed = false
    if (chat !== undefined && typeof callback.data === "string" && /^[\w-]{43}$/.test(callback.data)) {
      // The random capability can acknowledge only its own event, and only from its bound chat.
      const hash = await digest(callback.data)
      received = await db.acknowledge(hash, String(chat))
      // A button still on the message means the edit below did not reach it, so a later press of a
      // receipt this chat already confirmed writes the confirmation again.
      confirmed = received || await db.receiptRecorded(hash, String(chat))
    }
    // Every press is answered here, so the button never stays on "loading".
    await call("answerCallbackQuery", { callback_query_id: callback.id, text: confirmed ? RECEIPT_NOTE : "This receipt has expired." })
    // The confirmation is also written into the message, where it stays visible, and the button goes.
    const text = source?.text, messageId = source?.message_id
    if (confirmed && chat !== undefined && typeof messageId === "number" && typeof text === "string" && !text.endsWith(RECEIPT_NOTE)) {
      await call("editMessageText", { chat_id: chat, message_id: messageId, text: `${text}\n\n${RECEIPT_NOTE}` })
    }
    return { outcome: received ? "receipt" : confirmed ? "receipt_repeated" : "receipt_refused", replyFailed }
  }
  return { outcome: "ignored", replyFailed }
}

/**
 * `POST /telegram/webhook`. Telegram sends the secret given to setWebhook in a header; any request
 * without it is refused before its body is read. Telegram repeats an update until it gets a 2xx
 * answer, so each update is claimed by its `update_id` and handled once:
 *
 * - 200: handled now, handled by an earlier delivery, or not something this bot reads.
 * - 401: no secret, or a wrong one. 405: not a POST. 503: the Worker has no usable secret or token.
 * - 503 with Retry-After: another request is still handling this update.
 * - 500: handling failed; the claim is given back, and Telegram's next delivery is handled.
 *
 * Answers carry no body, and the log line carries the outcome only.
 */
export async function telegramWebhook(request: Request, env: Env, db: Database, transport: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  const answer = (status: number, extra: Record<string, string> = {}) => new Response(null, { status, headers: { ...headers, ...extra } })
  if (request.method !== "POST") return answer(405, { Allow: "POST" })
  const secret = env.TELEGRAM_WEBHOOK_SECRET
  if (!env.TELEGRAM_BOT_TOKEN || !usableWebhookSecret(secret)) return answer(503)
  const given = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
  if (!given || given.length > 256 || !await sameSecret(given, secret)) return answer(401)
  let held: { id: number; claim: string } | undefined
  try {
    const update = await readUpdate(request)
    if (!update) return answer(200)
    const taken = await db.claimUpdate(update.update_id)
    if (taken === "done") return answer(200)
    if (taken === "busy") return answer(503, { "Retry-After": "5" })
    held = { id: update.update_id, claim: taken.claim }
    const result = await handleUpdate(db, env, update, transport)
    await db.finishUpdate(held.id, held.claim)
    console.log(JSON.stringify({ event: "alerts_telegram_update", ...result }))
    return answer(200)
  } catch {
    // Never log the failure itself: it can name stored values or a provider URL.
    if (held) try { await db.releaseUpdate(held.id, held.claim) } catch { /* The lease ends by itself. */ }
    console.log(JSON.stringify({ event: "alerts_telegram_update", outcome: "error" }))
    return answer(500)
  }
}

/** What Telegram reports about the webhook. Counts and flags only: no URL, no error text. */
export interface WebhookHealth { registered: boolean; pending: number; failing: boolean }
/** An error this recent, with updates still waiting, means deliveries are failing now. */
const RECENT_ERROR = 10 * 60_000
/**
 * Asks Telegram whether updates reach this Worker: a webhook is registered on WEBHOOK_PATH, and
 * no delivery is failing. Undefined without a bot. The poller calls it, so an unregistered or
 * failing webhook, which stops every /start, shows in the run's health.
 */
export async function webhookHealth(env: Env, transport: typeof fetch = fetch): Promise<WebhookHealth | undefined> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const response = await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {
    method: "POST", signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("Telegram unavailable")
  const info = record((await response.json() as { result?: unknown }).result)
  if (!info) throw new Error("Telegram unavailable")
  let registered = false
  try {
    const url = new URL(String(info.url))
    registered = url.protocol === "https:" && url.pathname === WEBHOOK_PATH
  } catch { /* An empty URL: no webhook is registered. */ }
  const pending = typeof info.pending_update_count === "number" ? info.pending_update_count : 0
  const lastError = typeof info.last_error_date === "number" ? info.last_error_date * 1000 : 0
  return { registered, pending, failing: pending > 0 && Date.now() - lastError < RECENT_ERROR }
}
