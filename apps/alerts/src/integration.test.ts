import { test } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { verifyMessage } from "viem"
import { CONTRACTS, CHAINS } from "@cobuilders/safenet-core"
import { parseSiweMessage } from "viem/siwe"
import { SqlDatabase } from "./testing/database.js"
import { challenge, authenticate } from "./auth.js"
import { api } from "./api.js"
import { digest, type Database } from "./db.js"
import { poll, adapters } from "./poller.js"
import { sendEvent, telegramUpdates } from "./delivery.js"
import { initialChronology, foldChronology } from "./chronology.js"
import type { Env, Subscription } from "./types.js"

const env: Env = { APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused",
  TELEGRAM_BOT_TOKEN: "test-only", TELEGRAM_BOT_NAME: "test_bot" }
const account = privateKeyToAccount(generatePrivateKey())

async function signed(db: SqlDatabase) {
  const c = await challenge(db, env, { wallet: account.address })
  const signature = await account.signMessage({ message: c.message })
  return { c, signature, session: await authenticate(db, env, { id: c.id, signature }, verifyMessage) }
}

test("real wallet signature, SIWE scope, atomic replay, expiry, wrong signer and service-only database access", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const c = await challenge(db, env, { wallet: account.address })
    const message = parseSiweMessage(c.message)
    assert.equal(message.chainId, CHAINS.mainnet.id)
    assert.equal(message.domain, "app.test")
    assert.equal(message.uri, env.APP_ORIGIN)
    const signature = await account.signMessage({ message: c.message })
    const outcomes = await Promise.allSettled([authenticate(db, env, { id: c.id, signature }, verifyMessage), authenticate(db, env, { id: c.id, signature }, verifyMessage)])
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1)
    const old = await challenge(db, env, { wallet: account.address }, Date.now() - 600_000)
    await assert.rejects(authenticate(db, env, { id: old.id, signature }, verifyMessage), /expired/)
    const fresh = await challenge(db, env, { wallet: CONTRACTS.staking.address })
    await assert.rejects(authenticate(db, env, { id: fresh.id, signature: await account.signMessage({ message: fresh.message }) }, verifyMessage), /verification failed/)
    await db.pg.exec("set role anon")
    await assert.rejects(db.pg.query("select * from alerts_subscriptions"), /permission denied/)
    await assert.rejects(db.pg.query("select alerts_authenticate($1,$2,$3)", [c.id, "x", "x"]), /permission denied/)
  } finally { await db.pg.close() }
})

test("API isolates wallets, refuses wrong origins, revokes deleted subscriptions and never exposes delivery capabilities", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const auth = await signed(db)
    const request = (path: string, method = "GET", body?: unknown, origin = env.APP_ORIGIN) => api(new Request(`https://alerts.test${path}`, {
      method, headers: { Origin: origin, Authorization: `Bearer ${auth.session.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, db, verifyMessage)
    assert.equal((await request("/subscriptions", "GET", undefined, "https://evil.test")).status, 403)
    assert.equal((await api(new Request("https://alerts.test/subscriptions", { headers: { Origin: env.APP_ORIGIN } }), env, db)).status, 401)
    const created = await request("/subscriptions", "POST", { triggers: ["cooldown", "missed"], participation: 75, missed: 3, channel: { kind: "telegram" } })
    assert.equal(created.status, 200)
    const { id } = await created.json() as { id: string }
    const list = await (await request("/subscriptions")).json() as Record<string, unknown>[]
    assert.equal(list.length, 1)
    assert.equal(list[0]!.status, "unverified")
    for (const secret of ["signature_hash", "telegram_chat", "link_hash", "wallet"]) assert.equal(secret in list[0]!, false)
    const other = await db.rpc<Subscription[]>("subscribe", { owner_wallet: CONTRACTS.staking.address.toLowerCase(), signature: "other", link: "other", settings: { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } } })
    await request(`/subscriptions/${other[0]!.id}`, "DELETE")
    assert.equal((await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${other[0]!.id}`)).length, 1)
    await request(`/subscriptions/${id}`, "DELETE")
    assert.equal((await (await request("/subscriptions")).json() as unknown[]).length, 0)
    await db.pg.query("update alerts_sessions set expires_at=now()-interval '1 second'")
    assert.equal((await request("/subscriptions")).status, 401)
  } finally { await db.pg.close() }
})

test("all five conditions reach delivery adapters; repeated Cron runs deduplicate and browser acknowledgement proves receipt separately", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const [sub] = await db.rpc<Subscription[]>("subscribe", { owner_wallet: account.address.toLowerCase(), signature: "verified", link: "link", settings: {
      triggers: ["cooldown", "rewards", "deregistered", "participation", "missed"], participation: 75, missed: 2, channel: { kind: "telegram" },
    } })
    await db.request(`alerts_subscriptions?id=eq.${sub!.id}`, "PATCH", { telegram_chat: "123" })
    const first = CONTRACTS.aegisFrostCoordinator.deployBlock
    const time = Math.floor(Date.now() / 1000)
    const signer = CONTRACTS.aegisConsensus.address
    const staker = CONTRACTS.staking.address
    const state = foldChronology(initialChronology(), [
      { kind: "member", block: first.toString(), index: 0, time, participant: signer, staker },
      ...[1, 2].flatMap(n => [
        { kind: "completed" as const, block: (first + BigInt(n)).toString(), index: 0, time: time - 86400, sid: `round${n}`, root: "root" },
        { kind: "attested" as const, block: (first + BigInt(n)).toString(), index: 1, time: time - 86400, sid: `round${n}` },
      ]),
    ], first + 2n, "hash", time)
    const received: string[] = []
    let ack = ""
    const io = { ...adapters,
      telegramUpdates: async () => {},
      advanceChronology: async () => ({ state, current: true, time }),
      walletConditions: async () => ({ failed: 0, validators: [staker], events: [
        { trigger: "cooldown" as const, key: "cooldown:1", body: "ready" },
        { trigger: "rewards" as const, key: "rewards:root", body: "claimable" },
        { trigger: "deregistered" as const, key: "deregistered:1", body: "deregistered" },
      ] }),
      sendEvent: (database: Database, configured: Env, subscription: Subscription, key: string, body: string) =>
        sendEvent(database, configured, subscription, key, body, async (_env, _sub, payload) => {
          received.push(key.split(":")[0]!); ack = payload.ack; return "accepted"
        }),
    }
    await poll(env, db, io)
    await poll(env, db, io)
    assert.deepEqual(received.sort(), ["cooldown", "deregistered", "missed", "participation", "rewards"])
    assert.equal((await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${sub!.id}`))[0]!.status, "unverified")
    assert.equal(await db.rpc("acknowledge", { acknowledgement: await digest(ack) }), true)
    assert.equal((await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${sub!.id}`))[0]!.status, "verified")
    assert.equal(await db.rpc("acknowledge", { acknowledgement: await digest(ack) }), false)
  } finally { await db.pg.close() }
})

test("Telegram linking accepts a private initiated chat only; links expire and are single-use", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const link = "x".repeat(43)
    const [sub] = await db.rpc<Subscription[]>("subscribe", { owner_wallet: account.address, signature: "sig", link: await digest(link), settings: { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } } })
    let privateChat = false
    const transport: typeof fetch = async () => Response.json({ ok: true, result: [{ update_id: privateChat ? 2 : 1, message: { text: `/start ${link}`, chat: { id: 123, type: privateChat ? "private" : "group" } } }] })
    await telegramUpdates(db, env, transport)
    assert.equal((await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${sub!.id}`))[0]!.telegram_chat, null)
    privateChat = true
    await telegramUpdates(db, env, transport)
    assert.equal((await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${sub!.id}`))[0]!.telegram_chat, "123")
    assert.equal(await db.rpc("link_telegram", { link: await digest(link), chat: "456" }), false)
    await db.request(`alerts_subscriptions?id=eq.${sub!.id}`, "PATCH", { link_hash: await digest(link), link_expires: new Date(0).toISOString() })
    assert.equal(await db.rpc("link_telegram", { link: await digest(link), chat: "456" }), false)
  } finally { await db.pg.close() }
})

test("failed delivery retries after its lease; concurrent claims and expired receipt tokens fail closed", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const [sub] = await db.rpc<Subscription[]>("subscribe", { owner_wallet: account.address, signature: "sig", link: "link", settings: { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } } })
    const send = async () => "failed" as const
    assert.equal(await sendEvent(db, env, sub!, "cooldown:1", "ready", send), "failed")
    assert.equal(await sendEvent(db, env, sub!, "cooldown:1", "ready", send), "duplicate")
    await db.pg.query("update alerts_deliveries set lease_until=now()-interval '1 second'")
    assert.equal(await sendEvent(db, env, sub!, "cooldown:1", "ready", async () => "accepted"), "accepted")
    assert.equal((await db.pg.query<{ attempts: number }>("select attempts from alerts_deliveries")).rows[0]!.attempts, 2)
    await db.pg.query("update alerts_deliveries set ack_expires=now()-interval '1 second',ack_hash='expired'")
    assert.equal(await db.rpc("acknowledge", { acknowledgement: "expired" }), false)
  } finally { await db.pg.close() }
})

test("a challenge expiring during verification cannot create a session", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const c = await challenge(db, env, { wallet: account.address })
    const signature = await account.signMessage({ message: c.message })
    await assert.rejects(authenticate(db, env, { id: c.id, signature }, async args => {
      const valid = await verifyMessage(args)
      await db.pg.query("update alerts_challenges set expires_at=now()-interval '1 second' where id=$1", [c.id])
      return valid
    }), /expired/)
    assert.equal((await db.pg.query("select * from alerts_sessions")).rows.length, 0)
  } finally { await db.pg.close() }
})

test("Telegram polling failure does not block browser delivery and keeps run health failed", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    await db.rpc("subscribe", { owner_wallet: account.address, signature: "sig", link: "link", settings: {
      triggers: ["cooldown"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} },
    } })
    let sent = 0
    await poll(env, db, { ...adapters,
      telegramUpdates: async () => { throw new Error("Telegram unavailable") },
      walletConditions: async () => ({ failed: 0, validators: [], events: [{ trigger: "cooldown", key: "cooldown:1", body: "ready" }] }),
      sendEvent: async () => { sent++; return "accepted" },
    })
    assert.equal(sent, 1)
    const [run] = await db.request<{ ok: boolean; accepted: number; failed: number }[]>("alerts_runs")
    assert.equal(run!.ok, false)
    assert.equal(run!.accepted, 1)
    assert.equal(run!.failed, 1)
  } finally { await db.pg.close() }
})

test("partial source failure delivers successful conditions while keeping the run unhealthy", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    await db.rpc("subscribe", { owner_wallet: account.address, signature: "sig", link: "link", settings: {
      triggers: ["cooldown", "rewards"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} },
    } })
    const delivered: string[] = []
    await poll(env, db, { ...adapters,
      telegramUpdates: async () => {},
      walletConditions: async () => ({ failed: 1, validators: [], events: [{ trigger: "cooldown", key: "cooldown:1", body: "ready" }] }),
      sendEvent: async (_db, _env, _sub, key) => { delivered.push(key); return "accepted" },
    })
    assert.deepEqual(delivered, ["cooldown:1"])
    const [run] = await db.request<{ ok: boolean; accepted: number; failed: number }[]>("alerts_runs")
    assert.equal(run!.ok, false)
    assert.equal(run!.accepted, 1)
    assert.equal(run!.failed, 1)
  } finally { await db.pg.close() }
})

test("a stale delivery attempt cannot overwrite a reclaimed lease", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const [sub] = await db.rpc<Subscription[]>("subscribe", { owner_wallet: account.address, signature: "sig", link: "link", settings: {
      triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" },
    } })
    await sendEvent(db, env, sub!, "cooldown:1", "ready", async () => {
      await db.pg.query("update alerts_deliveries set lease_until=now()-interval '1 second'")
      assert.equal(await db.rpc("reserve", { subscription_id: sub!.id, event: "cooldown:1", acknowledgement: "new-attempt" }), true)
      return "accepted"
    })
    const [delivery] = await db.request<{ ack_hash: string; state: string }[]>("alerts_deliveries")
    assert.equal(delivery!.ack_hash, "new-attempt")
    assert.equal(delivery!.state, "sending")
  } finally { await db.pg.close() }
})

test("Telegram receipts require the subscription's private chat", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const [sub] = await db.rpc<Subscription[]>("subscribe", { owner_wallet: account.address, signature: "sig", link: "link", settings: {
      triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" },
    } })
    await db.request(`alerts_subscriptions?id=eq.${sub!.id}`, "PATCH", { telegram_chat: "123" })
    const ack = "r".repeat(43)
    await db.rpc("reserve", { subscription_id: sub!.id, event: "cooldown:1", acknowledgement: await digest(ack) })
    for (const chat of [{ id: 456, type: "private" }, { id: 123, type: "group" }, { id: 123, type: "private" }]) {
      await telegramUpdates(db, env, async input => Response.json(String(input).endsWith("/getUpdates") ? {
        ok: true, result: [{ update_id: 1, callback_query: { id: "callback", data: ack, message: { chat } } }],
      } : { ok: true }))
      const [row] = await db.request<Subscription[]>(`alerts_subscriptions?id=eq.${sub!.id}`)
      assert.equal(row!.status, chat.id === 123 && chat.type === "private" ? "verified" : "unverified")
    }
  } finally { await db.pg.close() }
})

test("the poll lease survives the Worker execution window and only its holder can release it", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const first = crypto.randomUUID(), second = crypto.randomUUID()
    assert.equal(await db.rpc("lock_run", { holder: first }), true)
    assert.equal(await db.rpc("lock_run", { holder: second, release: true }), false)
    // The first Worker can still run at 14:30; a second invocation must wait.
    await db.pg.query("update alerts_lock set until_at=until_at-interval '14 minutes 30 seconds'")
    assert.equal(await db.rpc("lock_run", { holder: second }), false)
    await db.pg.query("update alerts_lock set until_at=until_at-interval '2 minutes'")
    assert.equal(await db.rpc("lock_run", { holder: second }), true)
    assert.equal(await db.rpc("lock_run", { holder: first, release: true }), false)
    assert.equal(await db.rpc("lock_run", { holder: second, release: true }), true)
  } finally { await db.pg.close() }
})
