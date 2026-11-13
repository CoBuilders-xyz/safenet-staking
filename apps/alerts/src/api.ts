import { authenticate, challenge, session, type VerifyWallet } from "./auth.js"
import { Database, digest, randomToken } from "./db.js"
import { sendTest } from "./delivery.js"
import { allowedOrigin } from "./origins.js"
import { HttpError, object, subscriptionInput, type Env } from "./types.js"

async function json(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new HttpError(415, "JSON required")
  if (!request.body) throw new HttpError(400, "Empty request")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 24_000) { await reader.cancel(); throw new HttpError(413, "Request too large") }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new HttpError(400, "Invalid JSON") }
}
export async function api(request: Request, env: Env, db = new Database(env.DB), verify?: VerifyWallet): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" })
  try {
    if (new URL(request.url).pathname === "/health" && request.method === "GET") {
      const run = await db.latestRun()
      const healthy = !!run?.ok && !!run.completed_at && Date.now() - Date.parse(run.completed_at) < 15 * 60_000
      return Response.json({ healthy }, { status: healthy ? 200 : 503, headers })
    }
    const origin = allowedOrigin(env, request.headers.get("Origin"))
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
    const path = new URL(request.url).pathname
    let result: unknown
    if (path === "/config" && request.method === "GET") {
      result = { vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null, telegramBot: env.TELEGRAM_BOT_NAME ?? null }
    } else if (path === "/auth/challenge" && request.method === "POST") {
      result = await challenge(db, env, origin, await json(request))
    } else if (path === "/auth/verify" && request.method === "POST") {
      result = await authenticate(db, env, origin, await json(request), verify)
    } else if (path === "/delivery/ack" && request.method === "POST") {
      const { ack } = object(await json(request))
      if (typeof ack !== "string" || !/^[\w-]{43}$/.test(ack)) throw new HttpError(400, "Invalid receipt")
      result = { received: await db.acknowledge(await digest(ack)) }
    } else {
      const owner = await session(db, request)
      if (path === "/subscriptions" && request.method === "GET") {
        // Never return delivery tokens, endpoint capabilities, chat IDs or signature hashes.
        const rows = await db.subscriptions(owner.wallet)
        result = rows.map(({ id, triggers, participation, missed, channel, status, last_delivery, telegram_chat, linked_at, link_expires, paused }) =>
          ({ id, triggers, participation, missed, channel: channel.kind, status, lastDelivery: last_delivery, paused,
            linked: channel.kind === "push" || !!telegram_chat, linkedAt: linked_at,
            // When the pending Telegram link code stops working. Null when linked, or when no code is left.
            linkExpiresAt: channel.kind === "telegram" && !telegram_chat ? link_expires : null }))
      } else if (path === "/subscriptions" && request.method === "POST") {
        const settings = subscriptionInput(await json(request))
        if (settings.channel.kind === "telegram" && (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_NAME)) throw new HttpError(503, "Telegram unavailable", "telegram_unavailable")
        if (settings.channel.kind === "push" && (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)) throw new HttpError(503, "Push unavailable", "push_unavailable")
        const link = randomToken()
        const created = await db.subscribe(owner.wallet, owner.signature_hash, settings, await digest(link))
        result = { id: created.id, telegramUrl: settings.channel.kind === "telegram" ? `https://t.me/${env.TELEGRAM_BOT_NAME}?start=${link}` : null }
      } else if (/^\/subscriptions\/[\da-f-]{36}$/.test(path) && request.method === "DELETE") {
        await db.unsubscribe(path.split("/")[2]!, owner.wallet)
        result = { removed: true }
      } else if (/^\/subscriptions\/[\da-f-]{36}\/(telegram-link|pause|resume|test)$/.test(path) && request.method === "POST") {
        const [, , id, action] = path.split("/") as [string, string, string, "telegram-link" | "pause" | "resume" | "test"]
        // The wallet's own subscription only. Another wallet's ID answers like an unknown one.
        const sub = (await db.subscriptions(owner.wallet)).find(row => row.id === id)
        if (!sub) throw new HttpError(404, "Not found")
        if (action === "pause" || action === "resume") {
          await db.setPaused(id, owner.wallet, action === "pause")
          result = { paused: action === "pause" }
        } else if (action === "telegram-link") {
          if (sub.channel.kind !== "telegram") throw new HttpError(400, "Not a Telegram subscription")
          if (sub.telegram_chat) throw new HttpError(409, "Telegram already linked", "linked")
          if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_NAME) throw new HttpError(503, "Telegram unavailable", "telegram_unavailable")
          // The new code replaces the old one: only the latest link works.
          const link = randomToken()
          const expiresAt = await db.reissueLink(id, owner.wallet, await digest(link))
          if (!expiresAt) throw new HttpError(409, "Subscription expired", "expired")
          result = { telegramUrl: `https://t.me/${env.TELEGRAM_BOT_NAME}?start=${link}`, expiresAt }
        } else {
          if (sub.status === "expired") throw new HttpError(409, "Subscription expired", "expired")
          if (sub.channel.kind === "telegram" && !sub.telegram_chat) throw new HttpError(409, "Telegram not linked", "not_linked")
          if (!await db.claimTest(id, owner.wallet)) throw new HttpError(429, "One test message per minute")
          const outcome = await sendTest(db, env, sub)
          if (outcome === "expired") throw new HttpError(409, "Subscription expired", "expired")
          if (outcome !== "accepted") throw new HttpError(502, "Delivery failed", "delivery")
          result = { sent: true }
        }
        // Aggregate only: the action, never a wallet, subscription or chat.
        console.log(JSON.stringify({ event: "alerts_subscription_action", action }))
      } else throw new HttpError(404, "Not found")
    }
    return Response.json(result, { headers })
  } catch (error) {
    const known = error instanceof HttpError
    return Response.json({ error: known ? error.message : "Service unavailable", code: known ? error.code : "unavailable" }, { status: known ? error.status : 503, headers })
  }
}
