import { test } from "node:test"
import assert from "node:assert/strict"
import { createECDH, createDecipheriv, hkdfSync } from "node:crypto"
import webPush from "web-push"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { deliver } from "./delivery.js"
import { subscriptionInput, type Env, type Subscription } from "./types.js"
import { noDatabase } from "./testing/database.js"

const env: Env = { APP_ORIGIN: "https://app.test", DB: noDatabase }
const base: Subscription = { id: crypto.randomUUID(), wallet: CONTRACTS.staking.address, triggers: ["cooldown"], participation: 75, missed: 3,
  channel: { kind: "telegram" }, telegram_chat: "123", status: "unverified", last_delivery: null }
const payload = { title: "Safenet", body: "Cooldown ready", ack: "receipt" }

test("Telegram sends only to the linked recipient, with receipt confirmation; provider rejection stays failed", async () => {
  let calls = 0
  const transport: typeof fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init!.body))
    assert.equal(body.chat_id, "123")
    assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data, "receipt")
    return Response.json({ ok: false })
  }
  assert.equal(await deliver({ ...env, TELEGRAM_BOT_TOKEN: "test-bot" }, base, payload, transport), "failed")
  assert.equal(await deliver(env, { ...base, telegram_chat: null }, payload, transport), "failed")
  assert.equal(calls, 1)
})
test("Web Push encrypts the real payload for the browser key, signs VAPID, and handles expired endpoints", async () => {
  const vapid = webPush.generateVAPIDKeys()
  const receiver = createECDH("prime256v1")
  receiver.generateKeys()
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const sub: Subscription = { ...base, channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {
    p256dh: receiver.getPublicKey().toString("base64url"), auth: Buffer.from(auth).toString("base64url"),
  } } }
  const configured = { ...env, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:test@example.test" }
  const transport: typeof fetch = async (_url, init) => {
    const headers = new Headers(init!.headers)
    assert.equal(headers.get("content-encoding"), "aes128gcm")
    assert.match(headers.get("authorization")!, /^vapid t=/)
    assert.equal(init!.redirect, "manual")
    const bytes = Buffer.from(init!.body as Uint8Array)
    const salt = bytes.subarray(0, 16)
    const keyLength = bytes[20]!
    const publicKey = bytes.subarray(21, 21 + keyLength)
    const shared = receiver.computeSecret(publicKey)
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), publicKey])
    const ikm = hkdfSync("sha256", shared, auth, info, 32)
    const key = hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)
    const nonce = hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: nonce\0"), 12)
    const encrypted = bytes.subarray(21 + keyLength)
    const decipher = createDecipheriv("aes-128-gcm", Buffer.from(key), Buffer.from(nonce))
    decipher.setAuthTag(encrypted.subarray(-16))
    const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()])
    assert.equal(plaintext.at(-1), 2)
    assert.deepEqual(JSON.parse(plaintext.subarray(0, -1).toString()), payload)
    return new Response(null, { status: 201 })
  }
  assert.equal(await deliver(configured, sub, payload, transport), "accepted")
  assert.equal(await deliver(configured, sub, payload, async () => new Response(null, { status: 410 })), "expired")
  assert.equal(await deliver(configured, sub, payload, async () => new Response(null, { status: 429 })), "failed")
})
test("subscription validation rejects SSRF, malformed keys and invalid thresholds", () => {
  const input = { triggers: ["missed"], participation: 75, missed: 3, channel: { kind: "telegram" } }
  assert.equal(subscriptionInput(input).missed, 3)
  for (const changes of [{ triggers: [] }, { triggers: ["total-absence"] }, { missed: 0 }, { missed: 1.5 }, { participation: NaN },
    { channel: { kind: "push", endpoint: "http://127.0.0.1/", keys: {} } },
    { channel: { kind: "push", endpoint: "https://fcm.googleapis.com.attacker.test/", keys: {} } }]) {
    assert.throws(() => subscriptionInput({ ...input, ...changes }))
  }
})
