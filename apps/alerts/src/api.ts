import { authenticate, challenge, session, type VerifyWallet } from "./auth.js"
import { Database, digest, randomToken } from "./db.js"
import { allowedOrigin } from "./origins.js"
import { HttpError, object, subscriptionInput, type Env, type Subscription } from "./types.js"

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
export async function api(request: Request, env: Env, db = new Database(env), verify?: VerifyWallet): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin", "X-Content-Type-Options": "nosniff" })
  try {
    if (new URL(request.url).pathname === "/health" && request.method === "GET") {
      const rows = await db.request<{ completed_at: string | null; ok: boolean }[]>("alerts_runs?order=started_at.desc&limit=1")
      const run = rows[0]
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
      result = { received: await db.rpc("acknowledge", { acknowledgement: await digest(ack) }) }
    } else {
      const owner = await session(db, request)
      if (path === "/subscriptions" && request.method === "GET") {
        // Never return delivery tokens, endpoint capabilities, chat IDs or signature hashes.
        const rows = await db.request<Subscription[]>(`alerts_subscriptions?wallet=eq.${owner.wallet}&order=created_at.asc`)
        result = rows.map(({ id, triggers, participation, missed, channel, status, last_delivery, telegram_chat }) =>
          ({ id, triggers, participation, missed, channel: channel.kind, status, lastDelivery: last_delivery, linked: channel.kind === "push" || !!telegram_chat }))
      } else if (path === "/subscriptions" && request.method === "POST") {
        const settings = subscriptionInput(await json(request))
        if (settings.channel.kind === "telegram" && (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_NAME)) throw new HttpError(503, "Telegram unavailable")
        if (settings.channel.kind === "push" && (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)) throw new HttpError(503, "Push unavailable")
        const link = randomToken()
        const rows = await db.rpc<Subscription[]>("subscribe", { owner_wallet: owner.wallet, signature: owner.signature_hash, settings, link: await digest(link) })
        result = { id: rows[0]!.id, telegramUrl: settings.channel.kind === "telegram" ? `https://t.me/${env.TELEGRAM_BOT_NAME}?start=${link}` : null }
      } else if (/^\/subscriptions\/[\da-f-]{36}$/.test(path) && request.method === "DELETE") {
        await db.request(`alerts_subscriptions?id=eq.${path.split("/")[2]}&wallet=eq.${owner.wallet}`, "DELETE")
        result = { removed: true }
      } else throw new HttpError(404, "Not found")
    }
    return Response.json(result, { headers })
  } catch (error) {
    const known = error instanceof HttpError
    return Response.json({ error: known ? error.message : "Service unavailable" }, { status: known ? error.status : 503, headers })
  }
}
