import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { verifyMessage } from "viem"
import { TestDatabase, noDatabase, at } from "./testing/database.js"
import { challenge, authenticate } from "./auth.js"
import { api } from "./api.js"
import { Database, LINK_PROCESSING_GRACE, LINK_START_WINDOW, digest, type SubscriptionSettings } from "./db.js"
import { sendEvent } from "./delivery.js"
import { poll, adapters } from "./poller.js"
import { parseStart, telegramWebhook, usableWebhookSecret, webhookHealth } from "./telegram.js"
import type { Env } from "./types.js"

const origin = "https://app.test"
const secret = "S3cret_webhook-value".repeat(2) // 40 characters of the alphabet Telegram allows.
const env: Env = { APP_ORIGIN: origin, DB: noDatabase, TELEGRAM_BOT_TOKEN: "test-only-token", TELEGRAM_BOT_NAME: "test_bot", TELEGRAM_WEBHOOK_SECRET: secret }
const account = privateKeyToAccount(generatePrivateKey())
const telegram: SubscriptionSettings = { triggers: ["cooldown"], participation: 75, missed: 3, channel: { kind: "telegram" } }
/** `env` without one binding. */
const without = (name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET"): Env => {
  const copy = { ...env }
  delete copy[name]
  return copy
}
const chatOf = async (db: TestDatabase, id: string) => (await db.query<{ telegram_chat: string | null }>(
  "select telegram_chat from alerts_subscriptions where id = ?", id))[0]!.telegram_chat

/** A request as Telegram sends it. `given` replaces the secret header; null sends none. */
function post(update: unknown, given: string | null = secret, body = JSON.stringify(update)) {
  return new Request("https://alerts.test/telegram/webhook", { method: "POST", body,
    headers: { "Content-Type": "application/json", ...(given === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": given }) } })
}
interface Call { method: string; body: Record<string, unknown> }
/** The Bot API, recorded. `fail` makes every call throw. */
function provider() {
  const state = { calls: [] as Call[], fail: false }
  const transport: typeof fetch = async (input, init) => {
    if (state.fail) throw new Error("Telegram unavailable")
    state.calls.push({ method: String(input).split("/").at(-1)!, body: JSON.parse(String(init!.body)) as Record<string, unknown> })
    return Response.json({ ok: true })
  }
  return Object.assign(state, { transport, texts: () => state.calls.map(call => [call.body.chat_id, call.body.text]) })
}
let nextUpdate = 1000
const start = (text: string, chat: number, type = "private", extra: Record<string, unknown> = {}) =>
  ({ update_id: nextUpdate++, message: { text, chat: { id: chat, type }, ...extra } })
const press = (data: unknown, chat: number, type = "private", text = "Safenet\nready") =>
  ({ update_id: nextUpdate++, callback_query: { id: "query", data, message: { message_id: 55, text, chat: { id: chat, type } } } })

test("the webhook refuses every request without the right secret, before it reads the body or the database", async () => {
  const telegramApi = provider()
  // `noDatabase` throws on any use, and an unread body stays unused.
  const refused = async (request: Request, status: number, configured: Env = env) => {
    const response = await telegramWebhook(request, configured, new Database(noDatabase), telegramApi.transport)
    assert.equal(response.status, status)
    assert.equal(await response.text(), "") // No body: nothing to learn from an answer.
    assert.equal(request.bodyUsed, false)
  }
  const update = start("/start", 7)
  await refused(post(update, null), 401)
  await refused(post(update, ""), 401)
  await refused(post(update, "wrong"), 401)
  await refused(post(update, `${secret.slice(0, -1)}x`), 401) // Same length, one character off.
  await refused(post(update, `${secret}x`), 401)
  await refused(post(update, secret.toLowerCase()), 401)
  await refused(post(update, "x".repeat(100_000)), 401)
  // A Worker with no secret, or one too weak to use, accepts nothing: not even a request that repeats it.
  await refused(post(update, secret), 503, without("TELEGRAM_WEBHOOK_SECRET"))
  await refused(post(update, "short"), 503, { ...env, TELEGRAM_WEBHOOK_SECRET: "short" })
  await refused(post(update, "x".repeat(31)), 503, { ...env, TELEGRAM_WEBHOOK_SECRET: "x".repeat(31) })
  await refused(post(update, `${"x".repeat(40)} `), 503, { ...env, TELEGRAM_WEBHOOK_SECRET: `${"x".repeat(40)} ` })
  await refused(post(update, secret), 503, without("TELEGRAM_BOT_TOKEN"))
  const get = await telegramWebhook(new Request("https://alerts.test/telegram/webhook", { headers: { "X-Telegram-Bot-Api-Secret-Token": secret } }),
    env, new Database(noDatabase), telegramApi.transport)
  assert.deepEqual([get.status, get.headers.get("Allow")], [405, "POST"])
  assert.equal(telegramApi.calls.length, 0)
  assert.equal(usableWebhookSecret("a".repeat(32)), true)
  assert.equal(usableWebhookSecret("a".repeat(257)), false)
  assert.equal(usableWebhookSecret(`${"a".repeat(40)}!`), false)
})

test("the API routes Telegram's request to the webhook without an Origin, and applies no CORS to it", async () => {
  const db = await TestDatabase.create()
  const telegramApi = provider()
  const fetched = mock.method(globalThis, "fetch", telegramApi.transport)
  try {
    const link = "a".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const refused = await api(post(start(`/start ${link}`, 123), "wrong"), env, db)
    assert.equal(refused.status, 401)
    assert.equal(await chatOf(db, sub.id), null)
    const response = await api(post(start(`/start ${link}`, 123)), env, db)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal(await chatOf(db, sub.id), "123")
    // The browser API still refuses a request without an allowed Origin.
    assert.equal((await api(new Request("https://alerts.test/config"), env, db)).status, 403)
  } finally { fetched.mock.restore(); await db.close() }
})

test("/start links a private chat at once; links are single-use, and every form of the command is read", async () => {
  assert.deepEqual(parseStart("/start"), { kind: "bare" })
  assert.deepEqual(parseStart("  /START  "), { kind: "bare" })
  assert.deepEqual(parseStart(`/start@Test_Bot \n ${"k".repeat(43)} `, "test_bot"), { kind: "code", code: "k".repeat(43) })
  assert.deepEqual(parseStart(`/Start ${"k".repeat(43)}`), { kind: "code", code: "k".repeat(43) })
  assert.deepEqual(parseStart("/start short"), { kind: "invalid" })
  assert.deepEqual(parseStart(`/start ${"k".repeat(43)} extra`), { kind: "invalid" })
  assert.equal(parseStart(`/start@other_bot ${"k".repeat(43)}`, "test_bot"), null)
  assert.equal(parseStart("/started"), null)
  assert.equal(parseStart("hello"), null)
  const db = await TestDatabase.create()
  try {
    const link = "x".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const telegramApi = provider()
    const send = async (update: unknown) => {
      const response = await telegramWebhook(post(update), env, db, telegramApi.transport)
      assert.equal(response.status, 200)
    }
    // A group gets neither a link nor a reply, whatever its ID looks like.
    await send(start(`/start ${link}`, -123, "group"))
    await send(start(`/start ${link}`, 123, "supergroup"))
    await send(start("/start", 5, "channel"))
    // Other text, and a command for another bot, are not for this bot.
    await send(start("hello", 9))
    await send(start(`/start@other_bot ${link}`, 10))
    await send({ update_id: nextUpdate++, message: { chat: { id: 9, type: "private" } } }) // A photo: no text.
    await send({ update_id: nextUpdate++, edited_message: { text: `/start ${link}`, chat: { id: 9, type: "private" } } })
    assert.equal(await chatOf(db, sub.id), null)
    assert.equal(telegramApi.calls.length, 0)
    // An unknown code gets one neutral reply.
    await send(start(`/start ${"y".repeat(43)}`, 123))
    assert.equal(await chatOf(db, sub.id), null)
    assert.deepEqual(telegramApi.texts(), [[123, "This link has expired or was already used. Open https://app.test/#/alerts and press \"Get a new Telegram link\"."]])
    // The real code links, in the same request, and the chat is told so.
    telegramApi.calls.length = 0
    await send(start(`/START@TEST_BOT   ${link}`, 123))
    const linked = (await db.subscriptions(account.address))[0]!
    assert.equal(linked.telegram_chat, "123")
    assert.ok(Math.abs(Date.parse(linked.linked_at!) - Date.now()) < 5000)
    assert.equal(linked.link_expires, null)
    assert.equal(telegramApi.calls.length, 1)
    assert.deepEqual([telegramApi.calls[0]!.method, telegramApi.calls[0]!.body.chat_id], ["sendMessage", 123])
    assert.match(telegramApi.calls[0]!.body.text as string, /^Linked\. Safenet alerts for this subscription will arrive in this chat\./)
    // The same link opened again in the same chat is not an error there.
    telegramApi.calls.length = 0
    await send(start(`/start ${link}`, 123))
    assert.deepEqual(telegramApi.texts(), [[123, "Already linked. Safenet alerts for this subscription arrive in this chat."]])
    // Another chat with the used code learns nothing: the same reply as for an unknown code. No relink.
    telegramApi.calls.length = 0
    await send(start(`/start ${link}`, 456))
    assert.equal(await chatOf(db, sub.id), "123")
    assert.deepEqual(telegramApi.texts(), [[456, "This link has expired or was already used. Open https://app.test/#/alerts and press \"Get a new Telegram link\"."]])
    assert.equal(await db.linkTelegram(await digest(link), "456"), false)
    // A bare /start: a pointer to the page for a new chat, and no "subscribe" for a chat that is linked.
    telegramApi.calls.length = 0
    await send(start("/start", 789))
    await send(start("/start", 123))
    await send(start("/start nonsense", 123))
    assert.deepEqual(telegramApi.texts(), [
      [789, "This bot sends Safenet alerts. Open https://app.test/#/alerts, subscribe with Telegram, and use the link it shows. The link opens this chat with a one-time code."],
      [123, "This chat is linked to Safenet alerts. Manage them at https://app.test/#/alerts."],
      [123, "This link has expired or was already used. This chat is already linked to Safenet alerts. Manage them at https://app.test/#/alerts. For a subscription that is not connected yet, press \"Get a new Telegram link\" there."],
    ])
    // A second subscription links to the same chat with its own code.
    const second = await db.subscribe(account.address, "sig", { ...telegram, triggers: ["rewards"] }, await digest("m".repeat(43)))
    await send(start(`/start ${"m".repeat(43)}`, 123))
    assert.equal(await chatOf(db, second.id), "123")
  } finally { await db.close() }
})

test("a code sent in time links even when its delivery is late; a late or stale one does not", async () => {
  const db = await TestDatabase.create()
  try {
    const telegramApi = provider()
    const send = async (link: string, sentAgo: number, chat: number) => telegramWebhook(
      post(start(`/start ${link}`, chat, "private", { date: Math.floor((Date.now() - sentAgo) / 1000) })), env, db, telegramApi.transport)
    // Created 40 minutes ago, so the code expired 30 minutes ago.
    const created = async (link: string, triggers: SubscriptionSettings["triggers"]) => {
      const sub = await db.subscribe(account.address, "sig", { ...telegram, triggers }, await digest(link))
      await db.query("update alerts_subscriptions set created_at = ?, link_expires = ? where id = ?", at(-40 * 60_000), at(-40 * 60_000 + LINK_START_WINDOW), sub.id)
      return sub
    }
    const inTime = await created("a".repeat(43), ["cooldown"])
    const late = await created("b".repeat(43), ["rewards"])
    await db.cleanup() // An expired code survives cleanup during the grace period.
    await send("a".repeat(43), 40 * 60_000 - LINK_START_WINDOW + 2000, 101) // Sent at 9:58; delivered 30 minutes later.
    await send("b".repeat(43), 40 * 60_000 - LINK_START_WINDOW - 2000, 102) // Sent at 10:02.
    assert.equal(await chatOf(db, inTime.id), "101")
    assert.equal(await chatOf(db, late.id), null)
    // Past the grace period, a code sent in time is refused and cleanup removes it.
    const stale = await created("c".repeat(43), ["deregistered"])
    await db.query("update alerts_subscriptions set link_expires = ? where id = ?", at(-LINK_PROCESSING_GRACE - 1000), stale.id)
    await send("c".repeat(43), LINK_PROCESSING_GRACE + 2 * 60_000, 103)
    assert.equal(await chatOf(db, stale.id), null)
    await db.cleanup()
    assert.equal((await db.query<{ link_hash: string | null }>("select link_hash from alerts_subscriptions where id = ?", stale.id))[0]!.link_hash, null)
  } finally { await db.close() }
})

test("guidance replies are bounded per chat; a link confirmation never is", async t => {
  const db = await TestDatabase.create()
  try {
    const telegramApi = provider()
    const realNow = Date.now
    let ahead = 0
    t.mock.method(Date, "now", () => realNow() + ahead)
    const send = (update: unknown) => telegramWebhook(post(update), env, db, telegramApi.transport)
    // Five guidance replies a minute for one chat. Every update still answers 200.
    for (let i = 0; i < 9; i++) assert.equal((await send(start(i % 2 ? "/start" : "/start nonsense", 7))).status, 200)
    assert.deepEqual(telegramApi.calls.map(call => call.body.chat_id), [7, 7, 7, 7, 7])
    // Another chat has its own allowance, and the table holds no chat ID.
    await send(start("/start", 8))
    assert.equal(telegramApi.calls.at(-1)!.body.chat_id, 8)
    const rows = await db.query<{ chat: string; count: number }>("select chat, count from alerts_telegram_replies order by count")
    assert.deepEqual(rows.map(row => row.count), [1, 5])
    assert.ok(rows.every(row => /^[\da-f]{64}$/.test(row.chat)))
    // A valid code links and is confirmed, even for the chat that used up its allowance.
    const sub = await db.subscribe(account.address, "sig", telegram, await digest("v".repeat(43)))
    telegramApi.calls.length = 0
    await send(start(`/start ${"v".repeat(43)}`, 7))
    assert.equal(await chatOf(db, sub.id), "7")
    assert.match(telegramApi.calls[0]!.body.text as string, /^Linked\./)
    // The repeat of that link is guidance, so it is not answered inside the same window.
    await send(start(`/start ${"v".repeat(43)}`, 7))
    assert.equal(telegramApi.calls.length, 1)
    // A minute later the chat is answered again.
    ahead = 61_000
    await send(start("/start", 7))
    assert.deepEqual(telegramApi.texts().at(-1), [7, "This chat is linked to Safenet alerts. Manage them at https://app.test/#/alerts."])
  } finally { await db.close() }
})

test("a press of Confirm receipt is answered in the same request, and the confirmation is written into the message", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, "link")
    await db.query("update alerts_subscriptions set telegram_chat = '123' where id = ?", sub.id)
    let ack = ""
    await sendEvent(db, env, { ...sub, telegram_chat: "123" }, "cooldown:1", "ready", async (_env, _sub, payload) => { ack = payload.ack; return "accepted" })
    const telegramApi = provider()
    const send = async (update: unknown) => assert.equal((await telegramWebhook(post(update), env, db, telegramApi.transport)).status, 200)
    const status = async () => (await db.query<{ status: string }>("select status from alerts_subscriptions where id = ?", sub.id))[0]!.status
    // Another chat, and a group, cannot confirm it. The press is still answered, and no message is edited.
    await send(press(ack, 999))
    await send(press(ack, 123, "group"))
    assert.deepEqual(telegramApi.calls.map(call => [call.method, call.body.text]), [
      ["answerCallbackQuery", "This receipt has expired."], ["answerCallbackQuery", "This receipt has expired."]])
    assert.equal(await status(), "unverified")
    // The linked chat confirms: the answer first, then the note in the message.
    telegramApi.calls.length = 0
    await send(press(ack, 123))
    assert.deepEqual(telegramApi.calls, [
      { method: "answerCallbackQuery", body: { callback_query_id: "query", text: "Receipt confirmed." } },
      { method: "editMessageText", body: { chat_id: 123, message_id: 55, text: "Safenet\nready\n\nReceipt confirmed.", reply_markup: { inline_keyboard: [] } } },
    ])
    assert.equal(await status(), "verified")
    assert.equal((await db.query<{ state: string }>("select state from alerts_deliveries"))[0]!.state, "received")
    // The button is still there when the edit did not arrive. The next press writes the confirmation
    // again and records no second receipt. A message that already carries the note is not edited.
    telegramApi.calls.length = 0
    await send(press(ack, 123))
    assert.deepEqual(telegramApi.calls.map(call => call.method), ["answerCallbackQuery", "editMessageText"])
    telegramApi.calls.length = 0
    await send(press(ack, 123, "private", "Safenet\nready\n\nReceipt confirmed."))
    assert.deepEqual(telegramApi.calls.map(call => [call.method, call.body.text]), [["answerCallbackQuery", "Receipt confirmed."]])
    // Data that is no receipt at all is answered too, so its button stops loading.
    telegramApi.calls.length = 0
    for (const data of ["nonsense", undefined, 42, "z".repeat(43)]) await send(press(data, 123))
    assert.deepEqual(telegramApi.calls.map(call => [call.method, call.body.text]), Array.from({ length: 4 }, () => ["answerCallbackQuery", "This receipt has expired."]))
  } finally { await db.close() }
})

test("a repeated delivery of one update is handled once", async () => {
  const db = await TestDatabase.create()
  try {
    const link = "d".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const telegramApi = provider()
    const update = start(`/start ${link}`, 123)
    const send = (body: unknown = update) => telegramWebhook(post(body), env, db, telegramApi.transport)
    assert.equal((await send()).status, 200)
    assert.equal(telegramApi.calls.length, 1)
    // Telegram repeats it: 200 again, and no second message, link or reply allowance.
    for (let i = 0; i < 3; i++) assert.equal((await send()).status, 200)
    assert.equal(telegramApi.calls.length, 1)
    assert.equal(await chatOf(db, sub.id), "123")
    assert.equal((await db.query("select * from alerts_telegram_replies")).length, 0)
    assert.deepEqual(await db.query("select update_id, state from alerts_telegram_updates"), [{ update_id: update.update_id, state: "done" }])
    // A repeated button press: one receipt, one answer.
    await db.query("update alerts_subscriptions set telegram_chat = '123'")
    let ack = ""
    await sendEvent(db, env, { ...sub, telegram_chat: "123" }, "cooldown:1", "ready", async (_env, _sub, payload) => { ack = payload.ack; return "accepted" })
    const pressed = press(ack, 123)
    telegramApi.calls.length = 0
    await send(pressed); await send(pressed)
    assert.deepEqual(telegramApi.calls.map(call => call.method), ["answerCallbackQuery", "editMessageText"])
  } finally { await db.close() }
})

test("an update another request is handling answers 503 until that request ends or its lease does", async () => {
  const db = await TestDatabase.create()
  try {
    const link = "e".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const telegramApi = provider()
    const update = start(`/start ${link}`, 123)
    const first = await db.claimUpdate(update.update_id) // Another request holds it.
    assert.ok(typeof first === "object")
    const busy = await telegramWebhook(post(update), env, db, telegramApi.transport)
    assert.deepEqual([busy.status, busy.headers.get("Retry-After")], [503, "5"])
    assert.equal(await chatOf(db, sub.id), null)
    assert.equal(telegramApi.calls.length, 0)
    // That request died: once its lease ends, the next delivery is handled.
    await db.query("update alerts_telegram_updates set lease_until = ?", at(-1000))
    assert.equal((await telegramWebhook(post(update), env, db, telegramApi.transport)).status, 200)
    assert.equal(await chatOf(db, sub.id), "123")
    assert.equal(await db.claimUpdate(update.update_id), "done")
    // The first request, slow rather than dead, comes back: its claim was taken over, so it can
    // neither release the update for another round nor finish one it does not hold.
    await db.releaseUpdate(update.update_id, first.claim)
    assert.equal(await db.claimUpdate(update.update_id), "done")
    const other = await db.claimUpdate(update.update_id + 1)
    assert.ok(typeof other === "object")
    await db.finishUpdate(update.update_id + 1, first.claim)
    assert.equal(await db.claimUpdate(update.update_id + 1), "busy")
    await db.finishUpdate(update.update_id + 1, other.claim)
    assert.equal(await db.claimUpdate(update.update_id + 1), "done")
  } finally { await db.close() }
})

test("a failure answers 500 and gives the update back; the next delivery completes it without a second link", async () => {
  const db = await TestDatabase.create()
  const lines: string[] = []
  const log = mock.method(console, "log", (line: string) => { lines.push(line) })
  try {
    const link = "f".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const telegramApi = provider()
    const update = start(`/start ${link}`, 987654321987)
    // The database fails after the chat is linked and told so.
    const finish = mock.method(db, "finishUpdate", async () => { throw new Error("database unavailable: secret detail") })
    const failed = await telegramWebhook(post(update), env, db, telegramApi.transport)
    finish.mock.restore()
    assert.equal(failed.status, 500)
    assert.equal(await failed.text(), "")
    assert.equal(await chatOf(db, sub.id), "987654321987")
    assert.equal((await db.query("select * from alerts_telegram_updates")).length, 0)
    // Telegram delivers it again. The chat is linked already, by this same code, so it is not refused.
    assert.equal((await telegramWebhook(post(update), env, db, telegramApi.transport)).status, 200)
    assert.deepEqual(telegramApi.calls.map(call => (call.body.text as string).split(".")[0]), ["Linked", "Already linked"])
    // A failure before anything changed leaves the update to be handled in full.
    const other = "g".repeat(43)
    const second = await db.subscribe(account.address, "sig", { ...telegram, triggers: ["rewards"] }, await digest(other))
    const next = start(`/start ${other}`, 555)
    const broken = mock.method(db, "linkTelegram", async () => { throw new Error("database unavailable") })
    assert.equal((await telegramWebhook(post(next), env, db, telegramApi.transport)).status, 500)
    broken.mock.restore()
    assert.equal((await telegramWebhook(post(next), env, db, telegramApi.transport)).status, 200)
    assert.equal(await chatOf(db, second.id), "555")
    // The log carries outcomes only: no chat, code, secret, token or error text.
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [
      { event: "alerts_telegram_update", outcome: "error" },
      { event: "alerts_telegram_update", outcome: "already_linked", replyFailed: false },
      { event: "alerts_telegram_update", outcome: "error" },
      { event: "alerts_telegram_update", outcome: "linked", replyFailed: false },
    ])
    for (const hidden of ["987654321987", "555", link, other, secret, env.TELEGRAM_BOT_TOKEN!, "secret detail"]) assert.equal(lines.join("").includes(hidden), false)
  } finally { log.mock.restore(); await db.close() }
})

test("a reply Telegram refuses, or that is slow, never undoes the link and never holds the answer", async t => {
  const db = await TestDatabase.create()
  const lines: string[] = []
  const log = mock.method(console, "log", (line: string) => { lines.push(line) })
  try {
    const link = "h".repeat(43)
    const sub = await db.subscribe(account.address, "sig", telegram, await digest(link))
    const telegramApi = provider()
    telegramApi.fail = true
    assert.equal((await telegramWebhook(post(start(`/start ${link}`, 123)), env, db, telegramApi.transport)).status, 200)
    assert.equal(await chatOf(db, sub.id), "123")
    assert.deepEqual(JSON.parse(lines[0]!), { event: "alerts_telegram_update", outcome: "linked", replyFailed: true })
    // A refusal by status counts as a failed reply too.
    const refusing: typeof fetch = async () => new Response(null, { status: 429 })
    await telegramWebhook(post(start("/start", 321)), env, db, refusing)
    assert.deepEqual(JSON.parse(lines[1]!), { event: "alerts_telegram_update", outcome: "start_bare", replyFailed: true })
    // The calls of one update share eight seconds. A slow answer leaves none for the edit.
    let ack = ""
    await sendEvent(db, env, { ...sub, telegram_chat: "123" }, "cooldown:1", "ready", async (_env, _sub, payload) => { ack = payload.ack; return "accepted" })
    const realNow = Date.now
    let ahead = 0
    t.mock.method(Date, "now", () => realNow() + ahead)
    const methods: string[] = []
    const slow: typeof fetch = async input => { methods.push(String(input).split("/").at(-1)!); ahead += 9000; return Response.json({ ok: true }) }
    assert.equal((await telegramWebhook(post(press(ack, 123)), env, db, slow)).status, 200)
    assert.deepEqual(methods, ["answerCallbackQuery"])
    assert.deepEqual(JSON.parse(lines[2]!), { event: "alerts_telegram_update", outcome: "receipt", replyFailed: true })
  } finally { log.mock.restore(); await db.close() }
})

test("a body that is no update is accepted and dropped, so Telegram does not send it again", async () => {
  const db = await TestDatabase.create()
  try {
    const telegramApi = provider()
    const bodies = ["", "not json", "[]", "null", "{}", JSON.stringify({ update_id: "7" }), JSON.stringify({ update_id: -1 }), JSON.stringify({ update_id: 1.5 }),
      JSON.stringify({ update_id: 1, message: { text: "x".repeat(70_000), chat: { id: 1, type: "private" } } })]
    for (const body of bodies) assert.equal((await telegramWebhook(post(null, secret, body), env, db, telegramApi.transport)).status, 200)
    // Well-formed updates of the wrong shape are taken once and ignored.
    for (const update of [{ update_id: 1 }, { update_id: 2, message: "text" }, { update_id: 3, message: { text: "/start", chat: null } },
      { update_id: 4, message: { text: "/start", chat: { id: "7", type: "private" } } }, { update_id: 5, message: { text: 7, chat: { id: 7, type: "private" } } },
      { update_id: 6, callback_query: { data: "x".repeat(43) } }, { update_id: 7, callback_query: { id: 9, data: "x".repeat(43) } }]) {
      assert.equal((await telegramWebhook(post(update), env, db, telegramApi.transport)).status, 200)
    }
    assert.equal(telegramApi.calls.length, 0)
    assert.equal((await db.query("select * from alerts_telegram_updates where state = 'done'")).length, 7)
  } finally { await db.close() }
})

test("the poll checks that Telegram delivers to the webhook, and never holds back a delivery for it", async () => {
  const info = (result: Record<string, unknown>): typeof fetch => async input => {
    assert.match(String(input), /\/getWebhookInfo$/)
    return Response.json({ ok: true, result })
  }
  const now = Math.floor(Date.now() / 1000)
  assert.deepEqual(await webhookHealth(env, info({ url: "https://alerts.example/telegram/webhook", pending_update_count: 0 })), { registered: true, pending: 0, failing: false })
  // No webhook, or one on another path: no /start arrives.
  assert.equal((await webhookHealth(env, info({ url: "" })))!.registered, false)
  assert.equal((await webhookHealth(env, info({ url: "https://alerts.example/other" })))!.registered, false)
  assert.equal((await webhookHealth(env, info({ url: "http://alerts.example/telegram/webhook" })))!.registered, false)
  // Updates waiting behind a recent error: deliveries fail now. An old error, or none waiting, is past.
  assert.equal((await webhookHealth(env, info({ url: "https://a.example/telegram/webhook", pending_update_count: 3, last_error_date: now - 60 })))!.failing, true)
  assert.equal((await webhookHealth(env, info({ url: "https://a.example/telegram/webhook", pending_update_count: 3, last_error_date: now - 3600 })))!.failing, false)
  assert.equal((await webhookHealth(env, info({ url: "https://a.example/telegram/webhook", pending_update_count: 0, last_error_date: now - 60 })))!.failing, false)
  // With the Worker's own origin configured, only its own URL counts: a webhook that another
  // deployment registered on the same path receives every Start, so this one is not healthy.
  const own: Env = { ...env, ALERTS_URL: "https://alerts.example/" }
  assert.equal((await webhookHealth(own, info({ url: "https://alerts.example/telegram/webhook" })))!.registered, true)
  assert.equal((await webhookHealth(own, info({ url: "https://staging.example/telegram/webhook" })))!.registered, false)
  assert.equal((await webhookHealth(own, info({ url: "https://alerts.example/telegram/webhook?x=1" })))!.registered, false)
  assert.equal((await webhookHealth(own, info({ url: "" })))!.registered, false)
  // A malformed origin matches nothing, so the mistake shows as an unhealthy run.
  assert.equal((await webhookHealth({ ...env, ALERTS_URL: "alerts.example" }, info({ url: "https://alerts.example/telegram/webhook" })))!.registered, false)
  await assert.rejects(webhookHealth(env, async () => new Response(null, { status: 502 })))
  assert.equal(await webhookHealth(without("TELEGRAM_BOT_TOKEN"), async () => { throw new Error("must not be called") }), undefined)

  const db = await TestDatabase.create()
  const lines: string[] = []
  const log = mock.method(console, "log", (line: string) => { lines.push(line) })
  try {
    await db.subscribe(account.address, "sig", { triggers: ["cooldown"], participation: 75, missed: 3,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "link")
    let sent = 0
    const io = { ...adapters,
      walletConditions: async () => ({ failed: 0, validators: [], events: [{ trigger: "cooldown" as const, key: `cooldown:${sent}`, body: "ready" }] }),
      sendEvent: async () => { sent++; return "accepted" as const } }
    const run = async (health: typeof adapters.webhookHealth) => {
      await poll(env, db, { ...io, webhookHealth: health })
      const [row] = await db.query<{ ok: number; accepted: number; failed: number }>("select ok, accepted, failed from alerts_runs order by started_at desc limit 1")
      return { ...row! }
    }
    assert.deepEqual(await run(async () => ({ registered: true, pending: 0, failing: false })), { ok: 1, accepted: 1, failed: 0 })
    // Each of these stops new links, so the run is unhealthy. The browser delivery still goes out.
    assert.deepEqual(await run(async () => ({ registered: false, pending: 0, failing: false })), { ok: 0, accepted: 1, failed: 1 })
    assert.deepEqual(await run(async () => ({ registered: true, pending: 4, failing: true })), { ok: 0, accepted: 1, failed: 1 })
    assert.deepEqual(await run(async () => { throw new Error("Telegram unavailable") }), { ok: 0, accepted: 1, failed: 1 })
    assert.deepEqual(await run(async () => undefined), { ok: 1, accepted: 1, failed: 0 }) // No bot configured.
    assert.equal(sent, 5)
    const polls = lines.map(line => JSON.parse(line) as Record<string, unknown>).filter(line => line.event === "alerts_poll")
    assert.deepEqual(polls[1], { event: "alerts_poll", evaluated: 1, accepted: 1, failed: 1, telegram: { registered: false, pending: 0, failing: false } })
  } finally { log.mock.restore(); await db.close() }
})

test("cleanup drops handled updates after two days, spent reply windows, and consumed codes after an hour", async () => {
  const db = await TestDatabase.create()
  try {
    const sub = await db.subscribe(account.address, "sig", telegram, await digest("c".repeat(43)))
    assert.equal(await db.linkTelegram(await digest("c".repeat(43)), "123"), true)
    assert.equal(await db.linkedWith(await digest("c".repeat(43)), "123"), true)
    assert.equal(await db.linkedWith(await digest("c".repeat(43)), "456"), false)
    for (const id of [1, 2]) { const taken = await db.claimUpdate(id); assert.ok(typeof taken === "object"); await db.finishUpdate(id, taken.claim) }
    await db.query("update alerts_telegram_updates set received_at = ? where update_id = 1", at(-49 * 3_600_000))
    assert.equal(await db.allowReply("old"), true)
    assert.equal(await db.allowReply("new"), true)
    await db.query("update alerts_telegram_replies set window_start = ? where chat = 'old'", at(-120_000))
    await db.cleanup()
    assert.deepEqual(await db.query("select update_id from alerts_telegram_updates"), [{ update_id: 2 }])
    assert.deepEqual(await db.query("select chat from alerts_telegram_replies"), [{ chat: "new" }])
    assert.equal(await db.linkedWith(await digest("c".repeat(43)), "123"), true) // Linked a moment ago: still recognised.
    await db.query("update alerts_subscriptions set linked_at = ? where id = ?", at(-61 * 60_000), sub.id)
    await db.cleanup()
    assert.deepEqual(await db.query("select link_hash, telegram_chat from alerts_subscriptions"), [{ link_hash: null, telegram_chat: "123" }])
  } finally { await db.close() }
})

test("a second subscription with the same alerts on the same destination is refused as a duplicate", async () => {
  const db = await TestDatabase.create()
  try {
    const c = await challenge(db, env, origin, { wallet: account.address })
    const { token } = await authenticate(db, env, origin, { id: c.id, signature: await account.signMessage({ message: c.message }) }, verifyMessage)
    const subscribe = async (body: unknown, configured = env) => {
      const response = await api(new Request("https://alerts.test/subscriptions", { method: "POST", body: JSON.stringify(body),
        headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }), configured, db)
      return [response.status, (await response.json() as { code?: string }).code]
    }
    const both = { triggers: ["cooldown", "participation"], participation: 100, missed: 3, channel: { kind: "telegram" } }
    assert.deepEqual(await subscribe(both), [200, undefined])
    // The same triggers in another order, and a threshold of a trigger that is not chosen, change nothing.
    assert.deepEqual(await subscribe(both), [409, "duplicate"])
    assert.deepEqual(await subscribe({ ...both, triggers: ["participation", "cooldown"], missed: 9 }), [409, "duplicate"])
    // Another threshold, other triggers or another channel is another subscription.
    assert.deepEqual(await subscribe({ ...both, participation: 90 }), [200, undefined])
    assert.deepEqual(await subscribe({ ...both, triggers: ["cooldown"] }), [200, undefined])
    assert.deepEqual(await subscribe({ ...both, triggers: ["cooldown", "participation", "missed"] }), [200, undefined])
    assert.deepEqual(await subscribe({ ...both, triggers: ["cooldown", "participation", "missed"], missed: 4 }), [200, undefined])
    // Two browsers can hold the same alerts; one browser cannot hold them twice.
    const pushEnv: Env = { ...env, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:test@example.test" }
    const push = (endpoint: string) => ({ ...both, channel: { kind: "push", endpoint: `https://fcm.googleapis.com/${endpoint}`, keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } } })
    assert.deepEqual(await subscribe(push("laptop"), pushEnv), [200, undefined])
    assert.deepEqual(await subscribe(push("phone"), pushEnv), [200, undefined])
    assert.deepEqual(await subscribe(push("laptop"), pushEnv), [409, "duplicate"])
    // Another wallet is not concerned, and a subscription that can no longer deliver does not block its replacement.
    await db.subscribe("0xother", "sig", both as SubscriptionSettings, "other")
    await db.query("update alerts_subscriptions set status = 'expired' where wallet != '0xother' and triggers = ?", JSON.stringify(both.triggers))
    assert.deepEqual(await subscribe(both), [200, undefined])
    assert.equal((await db.subscriptions(account.address.toLowerCase())).length, 8)
    // Without a usable webhook secret no /start can arrive, so Telegram is not offered at all.
    const unready: Env = { ...env, TELEGRAM_WEBHOOK_SECRET: "short" }
    assert.deepEqual(await subscribe({ ...both, triggers: ["rewards"] }, unready), [503, "telegram_unavailable"])
    const config = async (configured: Env) => (await (await api(new Request("https://alerts.test/config", { headers: { Origin: origin } }), configured, db)).json() as { telegramBot: string | null }).telegramBot
    assert.equal(await config(unready), null)
    assert.equal(await config(env), "test_bot")
  } finally { await db.close() }
})
