import { test } from "node:test"
import assert from "node:assert/strict"
import { verifyMessage } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { createSiweMessage, parseSiweMessage } from "viem/siwe"
import { CHAINS } from "@cobuilders/safenet-core"
import { TestDatabase, noDatabase } from "./testing/database.js"
import { allowedOrigins } from "./origins.js"
import { authenticate, challenge } from "./auth.js"
import { api } from "./api.js"
import { HttpError, type Env } from "./types.js"

const limo = "https://safenet.cobuilders.eth.limo"
const xyz = "https://safenet.cobuilders.xyz"
const base = { DB: noDatabase }
const env: Env = { ...base, APP_ORIGINS: `${limo},${xyz}` }
const account = privateKeyToAccount(generatePrivateKey())
const unavailable = (error: unknown) => error instanceof HttpError && error.status === 503

const call = (path: string, origin: string | null, configured: Env = env, body?: unknown, db?: TestDatabase) => api(new Request(`https://alerts.test${path}`, {
  method: body === undefined ? (path === "/config" ? "GET" : "OPTIONS") : "POST",
  headers: { ...(origin === null ? {} : { Origin: origin }), "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), configured, db, verifyMessage)

test("APP_ORIGINS and APP_ORIGIN merge into one normalized, exact allowlist", () => {
  assert.deepEqual(allowedOrigins(env), [limo, xyz])
  assert.deepEqual(allowedOrigins({ APP_ORIGINS: ` ${limo}/ , HTTPS://Safenet.Cobuilders.XYZ ,, ` }), [limo, xyz])
  assert.deepEqual(allowedOrigins({ APP_ORIGIN: xyz }), [xyz])
  assert.deepEqual(allowedOrigins({ APP_ORIGIN: xyz, APP_ORIGINS: `${limo},${xyz}` }), [xyz, limo])
  assert.deepEqual(allowedOrigins({ APP_ORIGINS: "http://localhost:5173,https://app.test:8443" }), ["http://localhost:5173", "https://app.test:8443"])
})

test("a malformed or empty origin configuration fails closed", () => {
  for (const bad of ["*", "https://*.eth.limo", "https://app.test/path", "http://app.test", "https://user:pass@app.test",
    "https://app.test/?x=1", "https://app.test/#x", "app.test", "null", "ftp://app.test", "http://[::1]:5173"]) {
    assert.throws(() => allowedOrigins({ APP_ORIGINS: `${xyz},${bad}` }), unavailable, bad)
    assert.throws(() => allowedOrigins({ APP_ORIGIN: bad }), unavailable, bad)
  }
  for (const empty of [{}, { APP_ORIGIN: "", APP_ORIGINS: " , " }]) assert.throws(() => allowedOrigins(empty), unavailable)
})

test("CORS reflects only an allowlisted origin and always varies on Origin", async () => {
  for (const origin of [limo, xyz]) {
    for (const path of ["/config", "/subscriptions"]) {
      const response = await call(path, origin)
      assert.equal(response.status, path === "/config" ? 200 : 204)
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin)
      assert.equal(response.headers.get("Vary"), "Origin")
    }
  }
  for (const origin of ["https://evil.test", "https://safenet.cobuilders.xyz.evil.test", "http://safenet.cobuilders.xyz", `${xyz}/`, "null", null]) {
    const response = await call("/config", origin)
    assert.equal(response.status, 403, String(origin))
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null)
    assert.equal(response.headers.get("Vary"), "Origin")
  }
  const legacy = await call("/config", "https://app.test", { ...base, APP_ORIGIN: "https://app.test" })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.headers.get("Access-Control-Allow-Origin"), "https://app.test")
  const broken = await call("/config", xyz, { ...base, APP_ORIGINS: `${xyz},https://*.eth.limo` })
  assert.equal(broken.status, 503)
  assert.equal(broken.headers.get("Access-Control-Allow-Origin"), null)
})

test("each allowlisted origin signs in with a SIWE message that names it; legacy APP_ORIGIN still works", async () => {
  const db = await TestDatabase.create()
  try {
    for (const [configured, origin] of [[env, limo], [env, xyz], [{ ...base, APP_ORIGIN: "https://app.test" }, "https://app.test"]] as const) {
      const c = await challenge(db, configured, origin, { wallet: account.address })
      const message = parseSiweMessage(c.message)
      assert.equal(message.uri, origin)
      assert.equal(message.domain, new URL(origin).host)
      const signature = await account.signMessage({ message: c.message })
      assert.match((await authenticate(db, configured, origin, { id: c.id, signature }, verifyMessage)).token, /^[\w-]{43}$/)
    }
    await assert.rejects(challenge(db, env, "https://evil.test", { wallet: account.address }), /Origin refused/)
    const c = await challenge(db, env, xyz, { wallet: account.address })
    const signature = await account.signMessage({ message: c.message })
    await assert.rejects(authenticate(db, env, "https://evil.test", { id: c.id, signature }, verifyMessage), /Origin refused/)
  } finally { await db.close() }
})

test("a challenge issued for one origin cannot be redeemed from another, and stays usable from its own", async () => {
  const db = await TestDatabase.create()
  try {
    const issued = await call("/auth/challenge", limo, env, { wallet: account.address }, db)
    assert.equal(issued.status, 200)
    const c = await issued.json() as { id: string; message: string }
    const signature = await account.signMessage({ message: c.message })
    const replay = await call("/auth/verify", xyz, env, { id: c.id, signature }, db)
    assert.equal(replay.status, 401)
    assert.deepEqual(await replay.json(), { error: "Challenge origin mismatch", code: "session" })
    const unlisted = await call("/auth/verify", "https://evil.test", env, { id: c.id, signature }, db)
    assert.equal(unlisted.status, 403)
    assert.equal((await db.challenge(c.id))!.used, false)
    const own = await call("/auth/verify", limo, env, { id: c.id, signature }, db)
    assert.equal(own.status, 200)
    assert.equal((await call("/auth/verify", limo, env, { id: c.id, signature }, db)).status, 401)
  } finally { await db.close() }
})

test("a stored SIWE message whose domain or URI differs from the request origin is refused before verification", async () => {
  const db = await TestDatabase.create()
  try {
    const now = new Date()
    const expires = new Date(now.getTime() + 5 * 60_000)
    const siwe = (domain: string, uri: string) => createSiweMessage({ address: account.address, chainId: CHAINS.mainnet.id, domain, uri,
      version: "1", nonce: "abcdefgh12345678", issuedAt: now, expirationTime: expires })
    for (const message of [siwe("evil.test", xyz), siwe(new URL(xyz).host, "https://evil.test"), siwe(new URL(limo).host, xyz), "not a SIWE message"]) {
      const id = await db.issueChallenge(account.address.toLowerCase(), message, expires.toISOString())
      let verified = false
      const verify = async (args: Parameters<typeof verifyMessage>[0]) => { verified = true; return verifyMessage(args) }
      await assert.rejects(authenticate(db, env, xyz, { id: id!, signature: await account.signMessage({ message }) }, verify), /origin mismatch/)
      assert.equal(verified, false)
    }
  } finally { await db.close() }
})
