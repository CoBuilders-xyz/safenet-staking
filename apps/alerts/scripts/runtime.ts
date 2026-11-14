import assert from "node:assert/strict"
import { resolve } from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse } from "miniflare"
import { CONTRACTS, CHAINS, stakingAbi, indexedEvent } from "@cobuilders/safenet-core"
import { encodeFunctionResult, numberToHex, encodeAbiParameters, encodeEventTopics, decodeFunctionData } from "viem"
import webPush from "web-push"
import { Database, digest } from "../src/db.js"
import { applyMigrations } from "../src/testing/database.js"
import { persistChronologyBatch } from "../src/archive.js"
import { initialChronology, type Chronology } from "../src/chronology.js"

// Runs the built production Worker in workerd, bound to a local D1 database. All external services
// are intercepted. This proves runtime compatibility, not live provider or fork delivery.
const vapid = webPush.generateVAPIDKeys()
const receiver = webPush.generateVAPIDKeys()
const env = {
  APP_ORIGINS: "https://app.test,https://second.test",
  MAINNET_RPC_URL: "https://rpc.test", GNOSIS_RPC_URL: "https://gnosis.test", SUBGRAPH_URL_MAINNET: "https://graph.test", TELEGRAM_BOT_TOKEN: "runtime-test-only", TELEGRAM_BOT_NAME: "test_bot",
  TELEGRAM_WEBHOOK_SECRET: "runtime-test-only-webhook-secret-0123456789", ALERTS_URL: "https://alerts.test",
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:test@example.test",
}
const first = CONTRACTS.aegisFrostCoordinator.deployBlock
const sid = numberToHex(1, { size: 32 })
let telegram = 0, push = 0
const linkReplies: { chat_id: number; text: string }[] = []
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
  compatibilityDate: "2026-10-29", compatibilityFlags: ["nodejs_compat"], bindings: env, d1Databases: { DB: crypto.randomUUID() },
  outboundService: async request => {
    const url = new URL(request.url)
    if (url.hostname === "graph.test") return RuntimeResponse.json({ data: {
      _meta: { block: { number: 100, timestamp: Number(BigInt(block.timestamp)) }, hasIndexingErrors: false },
      delegations: [{ id: "position", validator: { id: CONTRACTS.staking.address, registeredAtBlock: null, firstSeenAtBlock: "1" } }],
    } })
    if (url.hostname === "gnosis.test") {
      const body = await request.json() as { id: number; method: string; params: string[] }
      let result: unknown
      if (body.method === "eth_chainId") result = numberToHex(CHAINS.gnosis.id)
      else if (body.method === "eth_getBlockByNumber") result = { ...block,
        number: body.params[0] === "finalized" ? numberToHex(first + 1n) : body.params[0], hash: numberToHex(2, { size: 32 }),
      }
      else if (body.method === "eth_getLogs") {
        const attested = indexedEvent("aegisConsensus", "TransactionAttested")
        result = [{ address: CONTRACTS.aegisConsensus.address, blockNumber: numberToHex(first + 1n), blockHash: block.hash,
          logIndex: "0x0", transactionIndex: "0x0", transactionHash: block.hash, removed: false,
          topics: encodeEventTopics({ abi: [attested], eventName: "TransactionAttested",
            args: { safeTxHash: sid, safeId: sid, oracle: CONTRACTS.aegisConsensus.address } }),
          data: encodeAbiParameters(attested.inputs.filter(input => !("indexed" in input && input.indexed)), [1n, sid, sid, { r: { x: 1n, y: 1n }, z: 1n }]),
        }]
      } else throw new Error("Unexpected Gnosis runtime request")
      return RuntimeResponse.json({ id: body.id, jsonrpc: "2.0", result })
    }
    if (url.hostname === "rpc.test") {
      const body = await request.json() as { id: number; method: string; params: { data: `0x${string}` }[] }
      let result: unknown
      if (body.method === "eth_chainId") result = numberToHex(CHAINS.mainnet.id)
      else if (body.method === "eth_getBlockByNumber") result = block
      else if (body.method === "eth_call") {
        const call = decodeFunctionData({ abi: stakingAbi, data: body.params[0]!.data })
        if (call.functionName === "stakes") result = encodeFunctionResult({ abi: stakingAbi, functionName: "stakes", result: 1n })
        else result = call.functionName === "withdrawalQueues"
          ? encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalQueues", result: [1n, 1n] })
          : encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalNodes", result: [1n, 1n, 0n, 0n] })
      } else throw new Error(`Unexpected RPC method ${body.method}`)
      return RuntimeResponse.json({ id: body.id, jsonrpc: "2.0", result })
    }
    if (url.hostname === "api.telegram.org") {
      // The Cron run asks whether Telegram delivers to the webhook. It never polls for updates.
      if (url.pathname.endsWith("/getWebhookInfo")) return RuntimeResponse.json({ ok: true, result: { url: "https://alerts.test/telegram/webhook", pending_update_count: 0 } })
      assert.ok(url.pathname.endsWith("/sendMessage"))
      const body = await request.json() as { chat_id: string | number; text: string }
      // The webhook's own reply to /start; every other message is the cooldown alert.
      if (typeof body.chat_id === "number") { linkReplies.push(body as { chat_id: number; text: string }); return RuntimeResponse.json({ ok: true }) }
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
  // The Worker and this script share the database: seed it through the same data-access layer.
  const d1 = await mf.getD1Database("DB") as unknown as D1Database
  await applyMigrations(d1)
  const db = new Database(d1)
  for (const channel of [{ kind: "telegram" }, { kind: "push", endpoint: "https://fcm.googleapis.com/runtime-test", keys: { p256dh: receiver.publicKey, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } }]) {
    const sub = await db.subscribe(CONTRACTS.staking.address.toLowerCase(), "verified-test-signature",
      { triggers: ["cooldown", "missed"], participation: 75, missed: 3, channel }, crypto.randomUUID())
    if (channel.kind === "telegram") await d1.prepare("update alerts_subscriptions set telegram_chat = '123' where id = ?").bind(sub.id).run()
  }
  // Seed a completed, unmatched ceremony. Cron must recover its share inside workerd.
  const holder = crypto.randomUUID()
  await db.lockRun(holder)
  await persistChronologyBatch(db, holder, initialChronology(), [
    { kind: "share", block: first.toString(), index: 0, time: Math.floor(Date.now() / 1000), sid, root: sid,
      participant: CONTRACTS.aegisConsensus.address, staker: CONTRACTS.staking.address },
    { kind: "completed", block: first.toString(), index: 1, time: Math.floor(Date.now() / 1000), sid, root: sid },
  ], first, numberToHex(2, { size: 32 }), Math.floor(Date.now() / 1000))
  await db.releaseRun(holder)
  assert.equal((await mf.dispatchFetch("https://alerts.test/health")).status, 503)
  const config = await mf.dispatchFetch("https://alerts.test/config", { headers: { Origin: "https://second.test" } })
  assert.equal(config.status, 200)
  assert.equal(config.headers.get("access-control-allow-origin"), "https://second.test")
  assert.equal((await mf.dispatchFetch("https://alerts.test/config", { headers: { Origin: "https://evil.test" } })).status, 403)
  assert.equal((await config.json() as { vapidPublicKey: string }).vapidPublicKey, vapid.publicKey)
  // The webhook in workerd: the secret is compared with node:crypto, and /start links in the request.
  const linkCode = "r".repeat(43)
  const pendingLink = await db.subscribe(CONTRACTS.staking.address.toLowerCase(), "verified-test-signature",
    { triggers: ["rewards"], participation: 75, missed: 3, channel: { kind: "telegram" } }, await digest(linkCode))
  const webhook = (secret: string | null) => mf.dispatchFetch("https://alerts.test/telegram/webhook", { method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }) },
    body: JSON.stringify({ update_id: 1, message: { text: `/start ${linkCode}`, date: Math.floor(Date.now() / 1000), chat: { id: 456, type: "private" } } }) })
  const linkedChat = async () => (await d1.prepare("select telegram_chat from alerts_subscriptions where id = ?").bind(pendingLink.id).first<{ telegram_chat: string | null }>())!.telegram_chat
  assert.equal((await webhook(null)).status, 401)
  assert.equal((await webhook(`${env.TELEGRAM_WEBHOOK_SECRET.slice(0, -1)}x`)).status, 401)
  assert.equal(await linkedChat(), null)
  assert.equal((await webhook(env.TELEGRAM_WEBHOOK_SECRET)).status, 200)
  assert.equal(await linkedChat(), "456")
  assert.equal((await webhook(env.TELEGRAM_WEBHOOK_SECRET)).status, 200) // Telegram repeats the update: handled once.
  assert.equal(linkReplies.length, 1)
  assert.equal(linkReplies[0]!.chat_id, 456); assert.match(linkReplies[0]!.text, /^Linked\./)
  await d1.prepare("delete from alerts_subscriptions where id = ?").bind(pendingLink.id).run()
  const worker = await mf.getWorker()
  assert.equal((await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date() })).outcome, "ok")
  assert.equal(telegram, 1)
  assert.equal(push, 1)
  assert.equal((await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date() })).outcome, "ok")
  assert.equal(telegram, 1)
  assert.equal(push, 1)
  assert.equal((await mf.dispatchFetch("https://alerts.test/health")).status, 200)
  const rows = (await d1.prepare("select status from alerts_subscriptions").all<{ status: string }>()).results
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.status === "unverified"))
  const state = (await db.state<Chronology>("aegis"))!
  assert.equal(state.cursor, (first + 1n).toString())
  assert.deepEqual(state.rounds[0]!.present, [CONTRACTS.aegisConsensus.address.toLowerCase()])
  assert.equal(state.members[CONTRACTS.aegisConsensus.address.toLowerCase()]!.misses, 0)
  assert.equal((await d1.prepare("select sid from alerts_ceremonies where json_type(ceremony, '$.counted') is null").all()).results.length, 0)
  // Check the artifact never includes test credentials; bindings enter only at runtime.
  const built = await readFile(resolve(bundle, "index.js"), "utf8")
  assert.ok(!built.includes(env.TELEGRAM_BOT_TOKEN) && !built.includes(env.TELEGRAM_WEBHOOK_SECRET))
  console.log("workerd: D1 binding, config, Telegram webhook, scheduled cooldown, archived attendance, Telegram, encrypted Web Push and deduplication passed (mock providers)")
} finally { await mf.dispose() }
