import webPush from "web-push"
import { Database, digest, randomToken } from "./db.js"
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
  const body = "This is a test notification. Alerts for this subscription arrive here."
  if (sub.channel.kind === "push") return await sendEvent(db, env, sub, `test:${new Date().toISOString()}`, body, send) as DeliveryResult
  let result: DeliveryResult = "failed"
  try { result = await send(env, sub, { title: "Safenet", body }) } catch { /* Never log provider URLs or bodies. */ }
  if (result === "expired") await db.expireSubscription(sub.id)
  return result
}
