import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { verifyMessage } from "viem"
import { CONTRACTS, CHAINS } from "@cobuilders/safenet-core"
import { parseSiweMessage } from "viem/siwe"
import { TestDatabase, noDatabase, at } from "./testing/database.js"
import { challenge, authenticate } from "./auth.js"
import { api } from "./api.js"
import { LINK_PROCESSING_GRACE, digest, type Database, type SubscriptionSettings } from "./db.js"
import { poll, adapters } from "./poller.js"
import { sendEvent } from "./delivery.js"
import { initialChronology, foldChronology } from "./chronology.js"
import type { Env, Subscription } from "./types.js"

const origin = "https://app.test"
const env: Env = { APP_ORIGIN: origin, DB: noDatabase,
  TELEGRAM_BOT_TOKEN: "test-only", TELEGRAM_BOT_NAME: "test_bot", TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) }
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
    assert.equal(list[0]!.linked, false)
    // After /start binds a chat, the list says linked, as a boolean, and still never the chat ID.
    const code = new URL(telegramUrl).searchParams.get("start")!
    assert.equal(await db.linkTelegram(await digest(code), "987654321987"), true)
    const linked = (await (await request("/subscriptions")).json() as Record<string, unknown>[])[0]!
    assert.equal(linked.linked, true)
    assert.equal(linked.status, "unverified") // Linked is not delivery confirmation.
    assert.equal(JSON.stringify(linked).includes("987654321987"), false)
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
    for (let i = 0; i < 10; i++) await db.subscribe(account.address, "sig", { ...telegram, triggers: ["missed"], missed: i + 1 }, `link-${i}`)
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
      webhookHealth: async () => {},
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

test("migration 0003 upgrades a database that already holds subscriptions", async () => {
  const db = await TestDatabase.create(file => file < "0003")
  try {
    const wallet = CONTRACTS.staking.address.toLowerCase()
    await db.query(`insert into alerts_subscriptions(id, wallet, signature_hash, triggers, participation, missed, channel, telegram_chat, status, created_at)
      values ('old', ?, 'sig', '["cooldown"]', 75, 3, '{"kind":"telegram"}', '123', 'verified', ?)`, wallet, at(-86_400_000))
    await db.migrate(file => file >= "0003")
    const [old] = await db.subscriptions(wallet)
    assert.deepEqual({ linked: old!.telegram_chat, linked_at: old!.linked_at, paused: old!.paused, status: old!.status },
      { linked: "123", linked_at: null, paused: false, status: "verified" })
    assert.deepEqual((await db.activeSubscriptions("", 50)).map(sub => sub.id), ["old"])
    assert.equal(await db.claimTest("old", wallet), true)
    await assert.rejects(db.query("update alerts_subscriptions set paused = 2"))
  } finally { await db.close() }
})

test("several ready events go out as one message; each keeps its own key, and only a new one sends again", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    const acks: string[] = []
    const send = async (_env: Env, _sub: Subscription, payload: { ack: string }) => { acks.push(payload.ack); return "accepted" as const }
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "three", send, ["cooldown:1", "cooldown:2", "cooldown:3"]), "accepted")
    assert.equal(acks.length, 1)
    assert.deepEqual(await db.query("select event_key, state from alerts_deliveries order by event_key"),
      [1, 2, 3].map(id => ({ event_key: `cooldown:${id}`, state: "accepted" })))
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "three", send, ["cooldown:1", "cooldown:2", "cooldown:3"]), "duplicate")
    assert.equal(await sendEvent(db, env, sub, "cooldown:1", "four", send, ["cooldown:1", "cooldown:2", "cooldown:3", "cooldown:4"]), "accepted")
    assert.equal(acks.length, 2)
    // The one receipt of a message confirms delivery for the subscription.
    assert.equal(await db.acknowledge(await digest(acks[0]!)), true)
    assert.equal((await row(db, sub.id))!.status, "verified")
    // A failed message frees every key it covered for the next attempt.
    assert.equal(await sendEvent(db, env, sub, "cooldown:5", "two", async () => "failed", ["cooldown:5", "cooldown:6"]), "failed")
    await db.query("update alerts_deliveries set lease_until = ? where state = 'failed'", at(-1000))
    assert.equal(await sendEvent(db, env, sub, "cooldown:5", "two", send, ["cooldown:5", "cooldown:6"]), "accepted")
    assert.equal((await db.query("select * from alerts_deliveries where state = 'accepted' and attempts = 2")).length, 2)
  } finally { await db.close() }
})

test("a subscription's own actions: a new Telegram link, pause and resume, and a test message", async () => {
  const db = await TestDatabase.create()
  try {
    const c = await challenge(db, env, origin, { wallet: account.address })
    const { token } = await authenticate(db, env, origin, { id: c.id, signature: await account.signMessage({ message: c.message }) }, verifyMessage)
    const sentTo: { url: string; body: Record<string, unknown> }[] = []
    const provider = mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      sentTo.push({ url: String(input), body: JSON.parse(String(init!.body)) })
      return Response.json({ ok: true })
    })
    try {
      const request = (path: string, method = "POST", body?: unknown) => api(new Request(`https://alerts.test${path}`, {
        method, headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), env, db)
      const list = async () => (await (await request("/subscriptions", "GET")).json() as Record<string, unknown>[])[0]!
      const code = async (response: Response) => [response.status, (await response.json() as { code: string }).code]
      const created = await (await request("/subscriptions", "POST", { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } })).json() as { id: string; telegramUrl: string; expiresAt: string }
      const first = new URL(created.telegramUrl).searchParams.get("start")!
      const pending = await list()
      assert.equal(pending.linked, false)
      assert.equal(pending.linkedAt, null)
      assert.ok(Date.parse(pending.linkExpiresAt as string) > Date.now())
      // Each link is returned with its own expiry, the one the list shows while that link is the current one.
      assert.equal(created.expiresAt, pending.linkExpiresAt)
      // Not linked yet: no test message. Another wallet's ID answers like an unknown one.
      assert.deepEqual(await code(await request(`/subscriptions/${created.id}/test`)), [409, "not_linked"])
      const other = await db.subscribe(CONTRACTS.staking.address.toLowerCase(), "other", telegram, "other")
      for (const action of ["telegram-link", "pause", "resume", "test"]) assert.deepEqual(await code(await request(`/subscriptions/${other.id}/${action}`)), [404, "not_found"])
      // A new link replaces the old code.
      const reissued = await (await request(`/subscriptions/${created.id}/telegram-link`)).json() as { telegramUrl: string; expiresAt: string }
      const second = new URL(reissued.telegramUrl).searchParams.get("start")!
      assert.match(reissued.telegramUrl, /^https:\/\/t\.me\/test_bot\?start=[\w-]{43}$/)
      assert.notEqual(second, first)
      assert.equal((await list()).linkExpiresAt, reissued.expiresAt)
      assert.equal(await db.linkTelegram(await digest(first), "123"), false)
      assert.equal(await db.linkTelegram(await digest(second), "123"), true)
      const linked = await list()
      assert.equal(linked.linked, true)
      assert.equal(linked.linkExpiresAt, null)
      assert.ok(Math.abs(Date.parse(linked.linkedAt as string) - Date.now()) < 5000)
      assert.deepEqual(await code(await request(`/subscriptions/${created.id}/telegram-link`)), [409, "linked"])
      // A /start that links the chat between the API's read and its update is also reported as
      // linked, never as a subscription to delete.
      const racing = await db.subscribe(account.address.toLowerCase(), "sig", { ...telegram, triggers: ["rewards"] }, await digest("t".repeat(43)))
      const reissue = mock.method(db, "reissueLink", async () => {
        await db.linkTelegram(await digest("t".repeat(43)), "777")
        return null
      })
      try { assert.deepEqual(await code(await request(`/subscriptions/${racing.id}/telegram-link`)), [409, "linked"]) } finally { reissue.mock.restore() }
      await db.unsubscribe(racing.id, account.address.toLowerCase())
      // The test message goes to the linked chat, without a receipt button, once per minute.
      assert.equal((await list()).testRetryAfter, 0)
      const tested = await request(`/subscriptions/${created.id}/test`)
      assert.equal(tested.status, 200)
      assert.deepEqual(await tested.json(), { sent: true, retryAfter: 60 })
      assert.equal(sentTo.length, 1)
      assert.match(sentTo[0]!.url, /\/sendMessage$/)
      assert.equal(sentTo[0]!.body.chat_id, "123")
      assert.match(sentTo[0]!.body.text as string, /test notification/)
      assert.equal("reply_markup" in sentTo[0]!.body, false)
      // A second test inside the minute is refused, with the seconds left. The list carries them too.
      const refused = await request(`/subscriptions/${created.id}/test`)
      const refusal = await refused.json() as { code: string; retryAfter: number }
      assert.deepEqual([refused.status, refusal.code], [429, "rate"])
      assert.ok(refusal.retryAfter >= 55 && refusal.retryAfter <= 60)
      assert.equal((await list()).testRetryAfter, refusal.retryAfter)
      assert.equal(sentTo.length, 1)
      // A test that loses the race with a delete is "not found", not a limit to wait out.
      const doomed = await db.subscribe(account.address.toLowerCase(), "sig", { ...telegram, triggers: ["deregistered"] }, "doomed")
      await db.query("update alerts_subscriptions set telegram_chat = '1' where id = ?", doomed.id)
      const gone = mock.method(db, "claimTest", async () => { await db.unsubscribe(doomed.id, account.address.toLowerCase()); return false })
      try { assert.deepEqual(await code(await request(`/subscriptions/${doomed.id}/test`)), [404, "not_found"]) } finally { gone.mock.restore() }
      // Paused: listed as paused and skipped by the poller. Resumed: evaluated again.
      assert.deepEqual(await (await request(`/subscriptions/${created.id}/pause`)).json(), { paused: true })
      assert.equal((await list()).paused, true)
      assert.equal((await db.activeSubscriptions("", 50)).some(sub => sub.id === created.id), false)
      assert.deepEqual(await (await request(`/subscriptions/${created.id}/resume`)).json(), { paused: false })
      assert.equal((await db.activeSubscriptions("", 50)).some(sub => sub.id === created.id), true)
      // A browser subscription has no Telegram link.
      const push = await db.subscribe(account.address.toLowerCase(), "sig", { triggers: ["cooldown"], participation: 75, missed: 3,
        channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "push-link")
      assert.deepEqual(await code(await request(`/subscriptions/${push.id}/telegram-link`)), [400, "invalid"])
      // The eleventh subscription is refused with its own code, not as an outage.
      for (let i = 0; i < 8; i++) await db.subscribe(account.address.toLowerCase(), "sig", { ...telegram, triggers: ["missed"], missed: i + 1 }, `fill-${i}`)
      assert.deepEqual(await code(await request("/subscriptions", "POST", { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } })), [409, "limit"])
      // Telegram refusing the chat expires the subscription.
      provider.mock.mockImplementation(async () => new Response(null, { status: 403 }))
      await db.query("update alerts_subscriptions set tested_at = null")
      assert.deepEqual(await code(await request(`/subscriptions/${created.id}/test`)), [409, "expired"])
      assert.equal((await list()).status, "expired")
    } finally { provider.mock.restore() }
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

test("partial source failure delivers successful conditions while keeping the run unhealthy", async () => {
  const db = await TestDatabase.create()
  try {
    await db.subscribe(account.address, "sig", { triggers: ["cooldown", "rewards"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "link")
    const delivered: string[] = []
    await poll(env, db, { ...adapters,
      webhookHealth: async () => {},
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
      webhookHealth: async () => {},
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
    const io = { ...adapters, webhookHealth: async () => {},
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
    await db.query("update alerts_subscriptions set link_expires = ?", at(-LINK_PROCESSING_GRACE - 1000)) // Expired and past the grace period.
    await db.query("update alerts_deliveries set ack_expires = ?", at(-1000))
    await db.query("insert into alerts_runs(started_at) values (?), (?)", at(-400 * 86_400_000), at(-380 * 86_400_000))
    // A day-old test message row goes; a recent one, and every condition key, stays.
    await db.reserve(sub.id, "test:old", "old-test")
    await db.reserve(sub.id, "test:new", "new-test")
    await db.query("update alerts_deliveries set updated_at = ? where event_key = 'test:old'", at(-25 * 3_600_000))
    await db.cleanup()
    assert.deepEqual((await db.query<{ event_key: string }>("select event_key from alerts_deliveries order by event_key")).map(item => item.event_key), ["cooldown:1", "test:new"])
    assert.equal((await db.query("select * from alerts_challenges")).length, 0)
    assert.deepEqual(await db.query("select link_hash from alerts_subscriptions"), [{ link_hash: null }])
    assert.deepEqual(await db.query("select ack_hash, event_key from alerts_deliveries where event_key = 'cooldown:1'"), [{ ack_hash: null, event_key: "cooldown:1" }])
    assert.equal((await db.query("select * from alerts_runs")).length, 1)
  } finally { await db.close() }
})
