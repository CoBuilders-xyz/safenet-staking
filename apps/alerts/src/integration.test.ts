import { test } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { verifyMessage } from "viem"
import { CONTRACTS, CHAINS } from "@cobuilders/safenet-core"
import { parseSiweMessage } from "viem/siwe"
import { TestDatabase, noDatabase, at } from "./testing/database.js"
import { challenge, authenticate } from "./auth.js"
import { api } from "./api.js"
import { digest, type Database, type SubscriptionSettings } from "./db.js"
import { poll, adapters } from "./poller.js"
import { sendEvent, telegramUpdates } from "./delivery.js"
import { initialChronology, foldChronology } from "./chronology.js"
import type { Env, Subscription } from "./types.js"

const origin = "https://app.test"
const env: Env = { APP_ORIGIN: origin, DB: noDatabase,
  TELEGRAM_BOT_TOKEN: "test-only", TELEGRAM_BOT_NAME: "test_bot" }
const account = privateKeyToAccount(generatePrivateKey())
const telegram: SubscriptionSettings = { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } }
const row = async (db: TestDatabase, id: string) => (await db.query<{ status: string; telegram_chat: string | null }>(
  "select status, telegram_chat from alerts_subscriptions where id = ?", id))[0]

async function signed(db: TestDatabase) {
  const c = await challenge(db, env, origin, { wallet: account.address })
  const signature = await account.signMessage({ message: c.message })
  return { c, signature, session: await authenticate(db, env, origin, { id: c.id, signature }, verifyMessage) }
}

test("real wallet signature, SIWE scope, atomic replay, expiry and wrong signer", async () => {
  const db = await TestDatabase.create()
  try {
    const c = await challenge(db, env, origin, { wallet: account.address })
    const message = parseSiweMessage(c.message)
    assert.equal(message.chainId, CHAINS.mainnet.id)
    assert.equal(message.domain, "app.test")
    assert.equal(message.uri, origin)
    const signature = await account.signMessage({ message: c.message })
    const outcomes = await Promise.allSettled([authenticate(db, env, origin, { id: c.id, signature }, verifyMessage), authenticate(db, env, origin, { id: c.id, signature }, verifyMessage)])
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1)
    assert.equal((await db.query("select * from alerts_sessions")).length, 1)
    const old = await challenge(db, env, origin, { wallet: account.address }, Date.now() - 600_000)
    await assert.rejects(authenticate(db, env, origin, { id: old.id, signature }, verifyMessage), /expired/)
    const fresh = await challenge(db, env, origin, { wallet: CONTRACTS.staking.address })
    await assert.rejects(authenticate(db, env, origin, { id: fresh.id, signature: await account.signMessage({ message: fresh.message }) }, verifyMessage), /verification failed/)
  } finally { await db.close() }
})

test("challenge storage is bounded per wallet", async () => {
  const db = await TestDatabase.create()
  try {
    for (let i = 0; i < 10; i++) await challenge(db, env, origin, { wallet: account.address })
    await assert.rejects(challenge(db, env, origin, { wallet: account.address }), /challenge window/)
    await challenge(db, env, origin, { wallet: CONTRACTS.staking.address })
    await db.query("update alerts_challenges set expires_at = ? where wallet = ?", at(-1000), account.address.toLowerCase())
    await challenge(db, env, origin, { wallet: account.address })
    assert.equal((await db.query("select * from alerts_challenges")).length, 2) // Expired challenges are deleted on issue.
  } finally { await db.close() }
})

test("API isolates wallets, refuses wrong origins, revokes deleted subscriptions and never exposes delivery capabilities", async () => {
  const db = await TestDatabase.create()
  try {
    const auth = await signed(db)
    const request = (path: string, method = "GET", body?: unknown, from = origin) => api(new Request(`https://alerts.test${path}`, {
      method, headers: { Origin: from, Authorization: `Bearer ${auth.session.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, db, verifyMessage)
    assert.equal((await request("/subscriptions", "GET", undefined, "https://evil.test")).status, 403)
    assert.equal((await api(new Request("https://alerts.test/subscriptions", { headers: { Origin: origin } }), env, db)).status, 401)
    const created = await request("/subscriptions", "POST", { triggers: ["cooldown", "missed"], participation: 75, missed: 3, channel: { kind: "telegram" } })
    assert.equal(created.status, 200)
    const { id, telegramUrl } = await created.json() as { id: string; telegramUrl: string }
    assert.match(telegramUrl, /^https:\/\/t\.me\/test_bot\?start=[\w-]{43}$/)
    const list = await (await request("/subscriptions")).json() as Record<string, unknown>[]
    assert.equal(list.length, 1)
    assert.equal(list[0]!.status, "unverified")
    assert.deepEqual(list[0]!.triggers, ["cooldown", "missed"])
    assert.equal(list[0]!.participation, 75)
    assert.equal(list[0]!.channel, "telegram")
    for (const secret of ["signature_hash", "telegram_chat", "link_hash", "wallet"]) assert.equal(secret in list[0]!, false)
    const other = await db.subscribe(CONTRACTS.staking.address.toLowerCase(), "other", telegram, "other")
    await request(`/subscriptions/${other.id}`, "DELETE")
    assert.ok(await row(db, other.id))
    await db.reserve(id, "cooldown:1", "receipt")
    await request(`/subscriptions/${id}`, "DELETE")
    assert.equal((await (await request("/subscriptions")).json() as unknown[]).length, 0)
    assert.equal((await db.query("select * from alerts_deliveries")).length, 0) // The delivery history goes with it.
    await db.query("update alerts_sessions set expires_at = ?", at(-1000))
    assert.equal((await request("/subscriptions")).status, 401)
  } finally { await db.close() }
})

test("each wallet holds at most ten subscriptions", async () => {
  const db = await TestDatabase.create()
  try {
    for (let i = 0; i < 10; i++) await db.subscribe(account.address, "sig", telegram, `link-${i}`)
    await assert.rejects(db.subscribe(account.address, "sig", telegram, "link-10"), /limit/)
    await db.subscribe(CONTRACTS.staking.address, "sig", telegram, "link-other")
  } finally { await db.close() }
})

test("all five conditions reach delivery adapters; repeated Cron runs deduplicate and browser acknowledgement proves receipt separately", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address.toLowerCase(), "verified", {
      triggers: ["cooldown", "rewards", "deregistered", "participation", "missed"], participation: 75, missed: 2, channel: { kind: "telegram" },
    }, "link")
    await db.query("update alerts_subscriptions set telegram_chat = '123' where id = ?", sub.id)
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
    assert.equal((await row(db, sub.id))!.status, "unverified")
    assert.equal(await db.acknowledge(await digest(ack)), true)
    assert.equal((await row(db, sub.id))!.status, "verified")
    assert.equal(await db.acknowledge(await digest(ack)), false)
    const [run] = await db.query<{ ok: number; evaluated: number; accepted: number }>("select * from alerts_runs order by started_at desc")
    assert.deepEqual({ ...run }, { ...run, ok: 1, evaluated: 1, accepted: 0 })
    assert.equal((await db.latestRun())!.ok, true)
  } finally { await db.close() }
})

test("Telegram linking accepts a private initiated chat only; links expire and are single-use", async () => {
  const db = await TestDatabase.create()
  try {
    const link = "x".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    let update: { update_id: number; message: { text: string; chat: { id: number; type: string } } } =
      { update_id: 1, message: { text: `/start ${link}`, chat: { id: 123, type: "group" } } }
    const sent: { chat_id: number; text: string }[] = []
    const transport: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/sendMessage")) { sent.push(JSON.parse(String(init!.body))); return Response.json({ ok: true }) }
      return Response.json({ ok: true, result: [update] })
    }
    await telegramUpdates(db, env, transport)
    assert.equal((await row(db, sub.id))!.telegram_chat, null)
    assert.equal(await db.state("telegram_offset"), 2)
    update = { update_id: 2, message: { text: `/start ${"y".repeat(43)}`, chat: { id: 123, type: "private" } } }
    await telegramUpdates(db, env, transport)
    assert.equal((await row(db, sub.id))!.telegram_chat, null)
    assert.equal(sent.length, 0) // An unknown code gets no reply.
    update = { update_id: 3, message: { text: `/start ${link}`, chat: { id: 123, type: "private" } } }
    await telegramUpdates(db, env, transport)
    assert.equal((await row(db, sub.id))!.telegram_chat, "123")
    assert.deepEqual(sent.map(m => m.chat_id), [123]) // Only the chat that was linked is confirmed.
    assert.match(sent[0]!.text, /^Linked\./)
    update = { update_id: 4, message: { text: `/start ${link}`, chat: { id: 456, type: "private" } } }
    await telegramUpdates(db, env, transport)
    assert.equal((await row(db, sub.id))!.telegram_chat, "123") // A reused code neither relinks nor replies.
    assert.equal(sent.length, 1)
    assert.equal(await db.linkTelegram(await digest(link), "456"), false)
    await db.query("update alerts_subscriptions set link_hash = ?, link_expires = ? where id = ?", await digest(link), new Date(0).toISOString(), sub.id)
    assert.equal(await db.linkTelegram(await digest(link), "456"), false)
  } finally { await db.close() }
})

test("a failed Telegram confirmation keeps the link and advances the offset", async () => {
  const db = await TestDatabase.create()
  try {
    const link = "z".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const transport: typeof fetch = async input => {
      if (String(input).endsWith("/sendMessage")) throw new Error("Telegram unavailable")
      return Response.json({ ok: true, result: [{ update_id: 7, message: { text: `/start ${link}`, chat: { id: 123, type: "private" } } }] })
    }
    await telegramUpdates(db, env, transport)
    assert.equal((await row(db, sub.id))!.telegram_chat, "123")
    assert.equal(await db.state("telegram_offset"), 8)
  } finally { await db.close() }
})

test("failed delivery retries after its lease; concurrent claims and expired receipt tokens fail closed", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    const send = async () => "failed" as const
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "ready", send), "failed")
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "ready", send), "duplicate")
    await db.query("update alerts_deliveries set lease_until = ?", at(-1000))
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "ready", async () => "accepted"), "accepted")
    assert.equal((await db.query<{ attempts: number }>("select attempts from alerts_deliveries"))[0]!.attempts, 2)
    await db.query("update alerts_deliveries set ack_expires = ?, ack_hash = 'expired'", at(-1000))
    assert.equal(await db.acknowledge("expired"), false)
  } finally { await db.close() }
})

test("an expired endpoint disables its subscription, and an older receipt does not reactivate it", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    let receipt = ""
    await sendEvent(db, env, sub, "cooldown:1", "ready", async (_env, _sub, payload) => { receipt = payload.ack; return "accepted" })
    assert.equal(await sendEvent(db, env, sub, "cooldown:2", "ready", async () => "expired"), "expired")
    assert.equal((await row(db, sub.id))!.status, "expired")
    assert.equal(await db.acknowledge(await digest(receipt)), true) // The delivery is still marked received.
    assert.equal((await row(db, sub.id))!.status, "expired")
    assert.deepEqual(await db.activeSubscriptions("", 50), [])
  } finally { await db.close() }
})

test("a challenge expiring during verification cannot create a session", async () => {
  const db = await TestDatabase.create()
  try {
    const c = await challenge(db, env, origin, { wallet: account.address })
    const signature = await account.signMessage({ message: c.message })
    await assert.rejects(authenticate(db, env, origin, { id: c.id, signature }, async args => {
      const valid = await verifyMessage(args)
      await db.query("update alerts_challenges set expires_at = ? where id = ?", at(-1000), c.id)
      return valid
    }), /expired/)
    assert.equal((await db.query("select * from alerts_sessions")).length, 0)
    assert.equal((await db.query<{ used: number }>("select used from alerts_challenges"))[0]!.used, 0)
  } finally { await db.close() }
})

test("Telegram polling failure does not block browser delivery and keeps run health failed", async () => {
  const db = await TestDatabase.create()
  try {
    await db.subscribe(account.address, "sig", { triggers: ["cooldown"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "link")
    let sent = 0
    await poll(env, db, { ...adapters,
      telegramUpdates: async () => { throw new Error("Telegram unavailable") },
      walletConditions: async () => ({ failed: 0, validators: [], events: [{ trigger: "cooldown", key: "cooldown:1", body: "ready" }] }),
      sendEvent: async () => { sent++; return "accepted" },
    })
    assert.equal(sent, 1)
    const [run] = await db.query<{ ok: number; accepted: number; failed: number }>("select * from alerts_runs")
    assert.equal(run!.ok, 0)
    assert.equal(run!.accepted, 1)
    assert.equal(run!.failed, 1)
  } finally { await db.close() }
})

test("partial source failure delivers successful conditions while keeping the run unhealthy", async () => {
  const db = await TestDatabase.create()
  try {
    await db.subscribe(account.address, "sig", { triggers: ["cooldown", "rewards"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "link")
    const delivered: string[] = []
    await poll(env, db, { ...adapters,
      telegramUpdates: async () => {},
      walletConditions: async () => ({ failed: 1, validators: [], events: [{ trigger: "cooldown", key: "cooldown:1", body: "ready" }] }),
      sendEvent: async (_db, _env, _sub, key) => { delivered.push(key); return "accepted" },
    })
    assert.deepEqual(delivered, ["cooldown:1"])
    const [run] = await db.query<{ ok: number; accepted: number; failed: number }>("select * from alerts_runs")
    assert.equal(run!.ok, 0)
    assert.equal(run!.accepted, 1)
    assert.equal(run!.failed, 1)
  } finally { await db.close() }
})

test("a Gnosis failure is attempted once per poll without delaying later independent deliveries", async () => {
  const db = await TestDatabase.create()
  try {
    for (const signature of ["first", "second"]) {
      await db.subscribe(account.address, signature, { triggers: ["cooldown", "missed"], participation: 75, missed: 3,
        channel: { kind: "push", endpoint: `https://fcm.googleapis.com/${signature}`, keys: {} } }, signature)
    }
    let attempts = 0, sent = 0
    const io = { ...adapters,
      telegramUpdates: async () => {},
      advanceChronology: async () => { attempts++; throw new Error("Gnosis unavailable") },
      walletConditions: async () => ({ failed: 0, validators: [], events: [{ trigger: "cooldown" as const, key: "cooldown:1", body: "ready" }] }),
      sendEvent: async () => { sent++; return "accepted" as const },
    }
    await poll(env, db, io)
    assert.equal(attempts, 1)
    assert.equal(sent, 2)
    const [run] = await db.query<{ ok: number; accepted: number; failed: number }>("select * from alerts_runs")
    assert.equal(run!.ok, 0)
    assert.equal(run!.accepted, 2)
    assert.equal(run!.failed, 2)
    await poll(env, db, io)
    assert.equal(attempts, 2) // A new poll retries; the failure is not cached across invocations.
  } finally { await db.close() }
})

test("a poll past its deadline saves its subscription cursor and the next poll continues from it", async t => {
  const db = await TestDatabase.create()
  try {
    const ids: string[] = []
    for (const name of ["a", "b"]) ids.push((await db.subscribe(account.address, name, { triggers: ["cooldown"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: `https://fcm.googleapis.com/${name}`, keys: {} } }, name)).id)
    ids.sort()
    const seen: string[] = []
    const realNow = Date.now
    let late = false
    t.mock.method(Date, "now", () => realNow() + (late ? 11 * 60_000 : 0))
    const io = { ...adapters, telegramUpdates: async () => {},
      walletConditions: async (_env: Env, sub: Subscription) => { seen.push(sub.id); late = seen.length === 1; return { failed: 0, validators: [], events: [] } } }
    await poll(env, db, io)
    late = false
    assert.deepEqual(seen, [ids[0]])
    assert.equal(await db.state("subscription_cursor"), ids[0])
    await db.releaseRun((await db.query<{ owner: string }>("select owner from alerts_lock"))[0]!.owner ?? "")
    await poll(env, db, io)
    assert.deepEqual(seen, ids)
    assert.equal(await db.state("subscription_cursor"), "")
  } finally { await db.close() }
})

test("a stale delivery attempt cannot overwrite a reclaimed lease", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    await sendEvent(db, env, sub, "cooldown:1", "ready", async () => {
      await db.query("update alerts_deliveries set lease_until = ?", at(-1000))
      assert.equal(await db.reserve(sub.id, "cooldown:1", "new-attempt"), true)
      return "accepted"
    })
    const [delivery] = await db.query<{ ack_hash: string; state: string }>("select * from alerts_deliveries")
    assert.equal(delivery!.ack_hash, "new-attempt")
    assert.equal(delivery!.state, "sending")
  } finally { await db.close() }
})

test("Telegram receipts require the subscription's private chat", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    await db.query("update alerts_subscriptions set telegram_chat = '123' where id = ?", sub.id)
    const ack = "r".repeat(43)
    await db.reserve(sub.id, "cooldown:1", await digest(ack))
    for (const chat of [{ id: 456, type: "private" }, { id: 123, type: "group" }, { id: 123, type: "private" }]) {
      await telegramUpdates(db, env, async input => Response.json(String(input).endsWith("/getUpdates") ? {
        ok: true, result: [{ update_id: 1, callback_query: { id: "callback", data: ack, message: { chat } } }],
      } : { ok: true }))
      assert.equal((await row(db, sub.id))!.status, chat.id === 123 && chat.type === "private" ? "verified" : "unverified")
    }
    assert.equal((await db.query<{ state: string }>("select state from alerts_deliveries"))[0]!.state, "received")
  } finally { await db.close() }
})

test("the poll lease survives the Worker execution window and only its holder can release it", async () => {
  const db = await TestDatabase.create()
  try {
    const first = crypto.randomUUID(), second = crypto.randomUUID()
    assert.equal(await db.lockRun(first), true)
    assert.equal(await db.releaseRun(second), false)
    // The first Worker can still run at 14:30; a second invocation must wait.
    await db.query("update alerts_lock set until_at = strftime('%Y-%m-%dT%H:%M:%fZ', until_at, '-870 seconds')")
    assert.equal(await db.lockRun(second), false)
    await db.query("update alerts_lock set until_at = strftime('%Y-%m-%dT%H:%M:%fZ', until_at, '-120 seconds')")
    assert.equal(await db.lockRun(second), true)
    assert.equal(await db.releaseRun(first), false)
    assert.equal(await db.releaseRun(second), true)
  } finally { await db.close() }
})

test("cleanup removes expired authentication, links and receipts, and keeps thirteen months of runs", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    await db.reserve(sub.id, "cooldown:1", "receipt")
    await challenge(db, env, origin, { wallet: account.address })
    await db.query("update alerts_challenges set expires_at = ?", at(-1000))
    await db.query("update alerts_subscriptions set link_expires = ?", at(-1000))
    await db.query("update alerts_deliveries set ack_expires = ?", at(-1000))
    await db.query("insert into alerts_runs(started_at) values (?), (?)", at(-400 * 86_400_000), at(-380 * 86_400_000))
    await db.cleanup()
    assert.equal((await db.query("select * from alerts_challenges")).length, 0)
    assert.deepEqual(await db.query("select link_hash from alerts_subscriptions"), [{ link_hash: null }])
    assert.deepEqual(await db.query("select ack_hash, event_key from alerts_deliveries"), [{ ack_hash: null, event_key: "cooldown:1" }])
    assert.equal((await db.query("select * from alerts_runs")).length, 1)
  } finally { await db.close() }
})
