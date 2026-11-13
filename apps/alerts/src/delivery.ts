import webPush from "web-push"
import { Database, digest, randomToken } from "./db.js"
import type { Env, Subscription } from "./types.js"

export type DeliveryResult = "accepted" | "expired" | "failed"
export async function deliver(env: Env, subscription: Subscription, payload: { title: string; body: string; ack: string }, transport: typeof fetch = fetch): Promise<DeliveryResult> {
  if (subscription.channel.kind === "telegram") {
    if (!env.TELEGRAM_BOT_TOKEN || !subscription.telegram_chat) return "failed"
    const response = await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ chat_id: subscription.telegram_chat, text: `${payload.title}\n${payload.body}`,
        reply_markup: { inline_keyboard: [[{ text: "Confirm receipt", callback_data: payload.ack }]] } }),
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

export async function sendEvent(db: Database, env: Env, sub: Subscription, key: string, body: string, send = deliver) {
  const ack = randomToken()
  if (!await db.reserve(sub.id, key, await digest(ack))) return "duplicate"
  let result: DeliveryResult = "failed"
  try { result = await send(env, sub, { title: "Safenet", body, ack }) } catch { /* Never log provider URLs or bodies. */ }
  // Only finish our own attempt. A reclaimed lease has a different receipt capability.
  const completed = await db.finishDelivery(sub.id, key, await digest(ack), result === "accepted")
  if (result === "expired" && completed) await db.expireSubscription(sub.id)
  // Provider acceptance does not prove the browser displayed the notification or a person saw it.
  return result
}

interface TelegramUpdate {
  update_id: number
  message?: { text?: string; date?: number; chat: { id: number; type: string } }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number; type: string } } }
}
export async function telegramUpdates(db: Database, env: Env, transport: typeof fetch = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const offset = await db.state<number>("telegram_offset")
  const response = await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ offset: offset ?? 0, limit: 100, timeout: 0, allowed_updates: ["message", "callback_query"] }),
  })
  if (!response.ok) throw new Error("Telegram polling unavailable")
  const data = await response.json() as { ok: boolean; result: TelegramUpdate[] }
  if (!data.ok) throw new Error("Telegram polling unavailable")
  for (const update of data.result) {
    const message = update.message
    const link = message?.text?.match(/^\/start ([\w-]{43})$/)?.[1]
    // Confirm only a link that bound this chat. An unknown, expired or reused code gets no reply,
    // so the bot reveals nothing about codes. A failed confirmation does not undo the link.
    if (link && message?.chat.type === "private" && await db.linkTelegram(await digest(link), String(message.chat.id),
      message.date === undefined ? undefined : message.date * 1000)) {
      try {
        await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ chat_id: message.chat.id, text: "Linked. Safenet alerts for this subscription will arrive in this chat." }),
        })
      } catch { /* Never log provider URLs or bodies. */ }
    }
    const callback = update.callback_query
    if (callback?.data && /^[\w-]{43}$/.test(callback.data) && callback.message?.chat.type === "private") {
      // The random capability can acknowledge only its own event, and only from its bound chat.
      await db.acknowledge(await digest(callback.data), String(callback.message.chat.id))
      await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ callback_query_id: callback.id }),
      })
    }
    await db.saveState("telegram_offset", update.update_id + 1)
  }
}
