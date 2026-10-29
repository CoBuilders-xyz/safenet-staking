import assert from "node:assert/strict"
import { resolve } from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from "miniflare"
import { CONTRACTS, CHAINS, stakingAbi } from "@cobuilders/safenet-core"
import { encodeFunctionResult, numberToHex } from "viem"
import webPush from "web-push"
import { SqlDatabase } from "../src/testing/database.js"

// Runs the built production Worker in workerd. All external services are intercepted.
// This proves runtime compatibility, not live provider or fork delivery.
const db = new SqlDatabase()
await db.setup()
const vapid = webPush.generateVAPIDKeys()
const receiver = webPush.generateVAPIDKeys()
const env = {
  APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://database.test", SUPABASE_SERVICE_KEY: "runtime-test-only",
  MAINNET_RPC_URL: "https://rpc.test", TELEGRAM_BOT_TOKEN: "runtime-test-only", TELEGRAM_BOT_NAME: "test_bot",
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:test@example.test",
}
for (const channel of [{ kind: "telegram" }, { kind: "push", endpoint: "https://fcm.googleapis.com/runtime-test", keys: { p256dh: receiver.publicKey, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } }]) {
  const [sub] = await db.rpc<{ id: string }[]>("subscribe", { owner_wallet: CONTRACTS.staking.address.toLowerCase(), signature: "verified-test-signature", link: crypto.randomUUID(),
    settings: { triggers: ["cooldown"], participation: 75, missed: 3, channel } })
  if (channel.kind === "telegram") await db.request(`alerts_subscriptions?id=eq.${sub!.id}`, "PATCH", { telegram_chat: "123" })
}
let telegram = 0, push = 0
const block = {
  number: numberToHex(100), hash: `0x${"a".repeat(64)}`, parentHash: `0x${"b".repeat(64)}`, timestamp: numberToHex(Math.floor(Date.now() / 1000)),
  gasLimit: numberToHex(30_000_000), gasUsed: numberToHex(0), difficulty: numberToHex(0), extraData: "0x", transactions: [],
}
const bundle = resolve(".cloudflare/output/v0/workers/default/bundle")
const mf = new Miniflare(convertV4MiniflareOptions({
  cf: false,
  cronTriggers: ["*/5 * * * *"],
  modules: ["index.js", ...(await readdir(resolve(bundle, "assets"))).filter(f => f.endsWith(".js")).map(f => `assets/${f}`)]
    .map(path => ({ type: "ESModule", path: resolve(bundle, path) })),
  modulesRoot: bundle,
  compatibilityDate: "2026-10-29", compatibilityFlags: ["nodejs_compat"], bindings: env,
  outboundService: async request => {
    const url = new URL(request.url)
    if (url.hostname === "database.test") {
      const body = request.method === "GET" ? undefined : await request.json()
      const value = await db.request(url.pathname.replace("/rest/v1/", "") + url.search, request.method, body)
      return RuntimeResponse.json(value ?? null)
    }
    if (url.hostname === "rpc.test") {
      const body = await request.json() as { id: number; method: string; params: { data: string }[] }
      let result: unknown
      if (body.method === "eth_chainId") result = numberToHex(CHAINS.mainnet.id)
      else if (body.method === "eth_getBlockByNumber") result = block
      else if (body.method === "eth_call") {
        // Distinguish the two imported ABI functions without duplicating signatures/selectors.
        const { toFunctionSelector } = await import("viem")
        const queue = stakingAbi.find(item => item.type === "function" && item.name === "withdrawalQueues")!
        result = body.params[0]!.data.startsWith(toFunctionSelector(queue))
          ? encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalQueues", result: [1n, 1n] })
          : encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalNodes", result: [1n, 1n, 0n, 0n] })
      } else throw new Error(`Unexpected RPC method ${body.method}`)
      return RuntimeResponse.json({ id: body.id, jsonrpc: "2.0", result })
    }
    if (url.hostname === "api.telegram.org") {
      if (url.pathname.endsWith("/getUpdates")) return RuntimeResponse.json({ ok: true, result: [] })
      assert.ok(url.pathname.endsWith("/sendMessage"))
      const body = await request.json() as { chat_id: string; text: string }
      assert.equal(body.chat_id, "123"); assert.match(body.text, /cooldown/)
      telegram++
      return RuntimeResponse.json({ ok: true })
    }
    if (url.hostname === "fcm.googleapis.com") {
      assert.equal(request.headers.get("content-encoding"), "aes128gcm")
      assert.match(request.headers.get("authorization")!, /^vapid t=/)
      assert.ok((await request.arrayBuffer()).byteLength > 100)
      push++
      return new RuntimeResponse(null, { status: 201 })
    }
    throw new Error("Unexpected runtime network destination")
  },
}))
try {
  assert.equal((await mf.dispatchFetch("https://alerts.test/health")).status, 503)
  const config = await mf.dispatchFetch("https://alerts.test/config", { headers: { Origin: env.APP_ORIGIN } })
  assert.equal(config.status, 200)
  assert.equal((await config.json() as { vapidPublicKey: string }).vapidPublicKey, vapid.publicKey)
  const worker = await mf.getWorker()
  assert.equal((await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date() })).outcome, "ok")
  assert.equal(telegram, 1)
  assert.equal(push, 1)
  assert.equal((await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date() })).outcome, "ok")
  assert.equal(telegram, 1)
  assert.equal(push, 1)
  assert.equal((await mf.dispatchFetch("https://alerts.test/health")).status, 200)
  const rows = await db.pg.query<{ status: string }>("select status from alerts_subscriptions")
  assert.ok(rows.rows.every(row => row.status === "unverified"))
  // Check the artifact never includes test credentials; bindings enter only at runtime.
  assert.ok(!(await readFile(resolve(bundle, "index.js"), "utf8")).includes(env.SUPABASE_SERVICE_KEY))
  console.log("workerd: config, scheduled cooldown, Telegram, encrypted Web Push and deduplication passed (mock providers)")
} finally { await mf.dispose(); await db.pg.close() }
