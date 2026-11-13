import webPush from "web-push"
import { Database, digest, randomToken } from "./db.js"
import { allowedOrigins } from "./origins.js"
import type { Env, Subscription } from "./types.js"

export type DeliveryResult = "accepted" | "expired" | "failed"
/**
 * Sends one notification. `ack` is the receipt capability: Telegram shows it as a "Confirm receipt"
 * button, and the browser's service worker posts it back once the notification is shown. A Telegram
 * message without `ack` carries no button.
 */
export async function deliver(env: Env, subscription: Subscription, payload: { title: string; body: string; ack?: string }, transport: typeof fetch = fetch): Promise<DeliveryResult> {
  if (subscription.channel.kind === "telegram") {
    if (!env.TELEGRAM_BOT_TOKEN || !subscription.telegram_chat) return "failed"
    const response = await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ chat_id: subscription.telegram_chat, text: `${payload.title}\n${payload.body}`,
        ...(payload.ack ? { reply_markup: { inline_keyboard: [[{ text: "Confirm receipt", callback_data: payload.ack }]] } } : {}) }),
    })
    if (response.status === 403) return "expired"
    if (!response.ok) return "failed"
    const result = await response.json() as { ok?: boolean }
    return result.ok ? "accepted" : "failed"
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return "failed"
  // Build RFC 8291 encrypted aes128gcm content and VAPID JWT using the audited adapter.
  // Use fetch instead of node https so Worker subrequests have a deadline and no redirects.
  const details = webPush.generateRequestDetails(subscription.channel, JSON.stringify(payload), {
    TTL: 3600, urgency: "normal", vapidDetails: {
      subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
    },
  })
  const response = await transport(details.endpoint, {
    method: details.method, headers: details.headers, body: new Uint8Array(details.body!),
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  })
  return response.ok ? "accepted" : response.status === 410 || response.status === 404 ? "expired" : "failed"
}

/**
 * Sends one message for the event keys in `covers` that were not delivered before, and records the
 * outcome on each of them. `key` is the first of them. The message carries one receipt capability,
 * that of the first key claimed here. "duplicate" when every key was already delivered.
 */
type Send = (env: Env, sub: Subscription, payload: { title: string; body: string; ack: string }) => Promise<DeliveryResult>
export async function sendEvent(db: Database, env: Env, sub: Subscription, key: string, body: string, send: Send = deliver, covers: string[] = [key]) {
  const claimed: { key: string; hash: string; ack: string }[] = []
  for (const eventKey of covers) {
    const ack = randomToken()
    const hash = await digest(ack)
    if (await db.reserve(sub.id, eventKey, hash)) claimed.push({ key: eventKey, hash, ack })
  }
  if (!claimed.length) return "duplicate"
  let result: DeliveryResult = "failed"
  try { result = await send(env, sub, { title: "Safenet", body, ack: claimed[0]!.ack }) } catch { /* Never log provider URLs or bodies. */ }
  // Only finish our own attempt. A reclaimed lease has a different receipt capability.
  let completed = 0
  for (const item of claimed) completed += await db.finishDelivery(sub.id, item.key, item.hash, result === "accepted")
  if (result === "expired" && completed) await db.expireSubscription(sub.id)
  // Provider acceptance does not prove the browser displayed the notification or a person saw it.
  return result
}

/** One test message to the subscription's own destination. A browser test carries a receipt, so showing it confirms delivery. */
export async function sendTest(db: Database, env: Env, sub: Subscription, send: typeof deliver = deliver): Promise<DeliveryResult> {
  const body = "This is a test message. Alerts for this subscription arrive here."
  if (sub.channel.kind === "push") return await sendEvent(db, env, sub, `test:${new Date().toISOString()}`, body, send) as DeliveryResult
  let result: DeliveryResult = "failed"
  try { result = await send(env, sub, { title: "Safenet", body }) } catch { /* Never log provider URLs or bodies. */ }
  if (result === "expired") await db.expireSubscription(sub.id)
  return result
}

interface TelegramChat { id: number; type: string }
interface TelegramUpdate {
  update_id: number
  message?: { text?: string; date?: number; chat: TelegramChat }
  callback_query?: { id: string; data?: string; message?: { message_id?: number; text?: string; chat: TelegramChat } }
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
/** All best-effort Telegram replies of one poll together. The poll itself may run for ten minutes. */
const REPLY_BUDGET = 30_000
const RECEIPT_NOTE = "Receipt confirmed."
/** Guidance replies sent in one poll. A poll reads at most 100 updates. */
const GUIDANCE_PER_POLL = 20
/** Aggregate counts of one Telegram poll. No chat, code or text. */
export interface TelegramCounts { updates: number; linked: number; startBare: number; startRejected: number; receipts: number; replyFailures: number }

export async function telegramUpdates(db: Database, env: Env, transport: typeof fetch = fetch): Promise<TelegramCounts | undefined> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const call = (method: string, body: unknown, timeout = 10_000) => transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeout), body: JSON.stringify(body),
  })
  const counts: TelegramCounts = { updates: 0, linked: 0, startBare: 0, startRejected: 0, receipts: 0, replyFailures: 0 }
  // Replies, answers and message edits are best effort: a failed one never undoes a link or a
  // receipt. They share one time budget, so a slow Telegram cannot hold back the deliveries that
  // follow this poll. Past the budget, updates are still read and recorded, without replies.
  let replyDeadline = Date.now() + REPLY_BUDGET
  const attempt = async (method: string, body: unknown) => {
    const left = replyDeadline - Date.now()
    if (left <= 0) { counts.replyFailures++; return }
    try { if (!(await call(method, body, Math.min(left, 5000))).ok) counts.replyFailures++ } catch { counts.replyFailures++ /* Never log provider URLs or bodies. */ }
  }
  let page: string | undefined
  try { page = `${allowedOrigins(env)[0]}/#/alerts` } catch { /* The replies then name the page without a link. */ }
  const where = page ? `Open ${page}` : "Open the Alerts page of Safenet"
  const manage = page ? `Manage them at ${page}` : "Manage them on the Alerts page of Safenet"
  // What a chat is told depends only on the code's outcome and on that chat's own state.
  const guidance = {
    bare: `This bot sends Safenet alerts. ${where}, subscribe with Telegram, and use the link it shows. The link opens this chat with a one-time code.`,
    rejected: `This link has expired or was already used. ${where} and press "Get a new Telegram link".`,
    bareLinked: `This chat is linked to Safenet alerts. ${manage}.`,
    rejectedLinked: `This link has expired or was already used. This chat is already linked to Safenet alerts. ${manage}. For a subscription that is not connected yet, press "Get a new Telegram link" there.`,
  }
  const offset = await db.state<number>("telegram_offset")
  const response = await call("getUpdates", { offset: offset ?? 0, limit: 100, timeout: 0, allowed_updates: ["message", "callback_query"] })
  if (!response.ok) throw new Error("Telegram polling unavailable")
  const data = await response.json() as { ok: boolean; result: TelegramUpdate[] }
  if (!data.ok) throw new Error("Telegram polling unavailable")
  replyDeadline = Date.now() + REPLY_BUDGET // The budget is for the replies, not for reading the updates.
  // One guidance reply per chat per poll, and GUIDANCE_PER_POLL in all, so repeated /start cannot
  // make the Worker send in bulk or hold back the deliveries that follow this poll.
  const guided = new Set<number>()
  let guidanceSent = 0
  for (const update of data.result) {
    counts.updates++
    const message = update.message
    // Private chats only: a code sent in a group would bind the group, and a reply there reaches every member.
    const start = message?.text !== undefined && message.chat.type === "private" && message.chat.id > 0
      ? parseStart(message.text, env.TELEGRAM_BOT_NAME) : null
    if (message && start) {
      const linked = start.kind === "code" && await db.linkTelegram(await digest(start.code), String(message.chat.id),
        message.date === undefined ? undefined : message.date * 1000)
      if (linked) {
        counts.linked++
        // A client can send the same /start again; the chat that was just told "Linked." gets no second answer.
        guided.add(message.chat.id)
        await attempt("sendMessage", { chat_id: message.chat.id, text: "Linked. Safenet alerts for this subscription will arrive in this chat." })
      } else {
        // An unknown, expired or reused code gets one neutral reply, so the bot reveals nothing about codes.
        const reason = start.kind === "bare" ? "bare" : "rejected"
        if (reason === "bare") counts.startBare++; else counts.startRejected++
        if (!guided.has(message.chat.id) && guidanceSent < GUIDANCE_PER_POLL) {
          guided.add(message.chat.id)
          guidanceSent++
          // A chat that already receives alerts is not told to subscribe: the page shows it as connected.
          const text = guidance[await db.chatLinked(String(message.chat.id)) ? `${reason}Linked` as const : reason]
          await attempt("sendMessage", { chat_id: message.chat.id, text, disable_web_page_preview: true })
        }
      }
    }
    const callback = update.callback_query
    if (callback?.data && /^[\w-]{43}$/.test(callback.data) && callback.message?.chat.type === "private") {
      // The random capability can acknowledge only its own event, and only from its bound chat.
      const hash = await digest(callback.data), chat = String(callback.message.chat.id)
      const received = await db.acknowledge(hash, chat)
      if (received) counts.receipts++
      // A button still on the message means the edit below did not reach it, so a later press of a
      // receipt this chat already confirmed writes the confirmation again.
      const confirmed = received || await db.receiptRecorded(hash, chat)
      // Telegram stops waiting for this answer after a few seconds, and a Cron run can come minutes
      // later. So the confirmation is also written into the message, where it stays visible.
      // Telegram refuses a late answer; that is expected, so it is not counted as a failed reply.
      if (Date.now() < replyDeadline) {
        try {
          await call("answerCallbackQuery", { callback_query_id: callback.id, text: confirmed ? "Receipt confirmed." : "This receipt has expired." }, 5000)
        } catch { /* The receipt is already recorded. */ }
      }
      const text = callback.message.text
      if (confirmed && callback.message.message_id !== undefined && text && !text.endsWith(RECEIPT_NOTE)) {
        await attempt("editMessageText", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, text: `${text}\n\n${RECEIPT_NOTE}` })
      }
    }
    await db.saveState("telegram_offset", update.update_id + 1)
  }
  return counts
}
