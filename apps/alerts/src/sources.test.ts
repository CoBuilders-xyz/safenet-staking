import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { decodeFunctionData, encodeFunctionResult, encodePacked, keccak256, numberToHex, encodeAbiParameters, encodeEventTopics, type AbiEvent, type Hex } from "viem"
import { CHAINS, CONTRACTS, merkleDropAbi, stakingAbi, indexedEvent } from "@cobuilders/safenet-core"
import { advanceChronology, walletConditions } from "./sources.js"
import { SqlDatabase } from "./testing/database.js"
import { initialChronology, type Chronology } from "./chronology.js"
import type { Env, Subscription } from "./types.js"

const wallet = CONTRACTS.safeToken.address
const validator = CONTRACTS.staking.address
const leaf = keccak256(encodePacked(["address", "uint256"], [wallet, 100n]))
const env: Env = { APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused",
  MAINNET_RPC_URL: "https://rpc.test", REWARDS_BASE_URL: "https://proof.test", SUBGRAPH_URL_MAINNET: "https://graph.test" }
const sub: Subscription = { id: crypto.randomUUID(), wallet, triggers: ["cooldown", "rewards", "deregistered"], participation: 75, missed: 3,
  channel: { kind: "telegram" }, telegram_chat: null, status: "unverified", last_delivery: null }
function transport(options: { stale?: boolean; root?: Hex; claimed?: bigint; registered?: boolean; stake?: bigint; wrongChain?: boolean;
  finalizedAge?: number; registeredAtBlock?: string | null; firstSeenAtBlock?: string; lastUpdatedAtBlock?: string;
  unavailable?: "cooldown" | "rewards" | "delegations" } = {}) {
  const timestamp = Math.floor(Date.now() / 1000) - (options.finalizedAge ?? 0)
  return mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith("https://proof.test")) {
      if (options.unavailable === "rewards") return new Response(null, { status: 503 })
      return Response.json({ cumulativeAmount: "100", merkleRoot: leaf, proof: [] })
    }
    if (url.startsWith("https://graph.test")) {
      if (options.unavailable === "delegations") return new Response(null, { status: 503 })
      const body = JSON.parse(String(init!.body))
      assert.match(body.query, /registeredAtBlock firstSeenAtBlock/)
      assert.equal(body.variables.wallet, wallet.toLowerCase())
      assert.equal(body.variables.block.number, 100)
      return Response.json({ data: { _meta: { block: { number: 100, timestamp: options.stale ? 1 : timestamp }, hasIndexingErrors: false },
        delegations: [{ id: "position", validator: { id: validator, registeredAtBlock: options.registeredAtBlock === undefined ? "80" : options.registeredAtBlock,
          firstSeenAtBlock: options.firstSeenAtBlock ?? "70",
          lastUpdatedAtBlock: options.lastUpdatedAtBlock ?? "90" } }] } })
    }
    assert.equal(new URL(url).origin, "https://rpc.test")
    const request = JSON.parse(String(init!.body))
    let result: unknown
    if (request.method === "eth_chainId") result = numberToHex(options.wrongChain ? CHAINS.gnosis.id : CHAINS.mainnet.id)
    else if (request.method === "eth_getBlockByNumber") {
      assert.equal(request.params[0], "finalized")
      result = { number: numberToHex(100), timestamp: numberToHex(timestamp), transactions: [] }
    } else if (request.method === "eth_call") {
      assert.equal(request.params[1], numberToHex(100))
      const data = request.params[0].data as Hex
      if (request.params[0].to.toLowerCase() === CONTRACTS.merkleDrop.address.toLowerCase()) {
        const call = decodeFunctionData({ abi: merkleDropAbi, data })
        result = call.functionName === "merkleRoot"
          ? encodeFunctionResult({ abi: merkleDropAbi, functionName: "merkleRoot", result: options.root ?? leaf })
          : encodeFunctionResult({ abi: merkleDropAbi, functionName: "cumulativeClaimed", result: options.claimed ?? 10n })
      } else {
        const call = decodeFunctionData({ abi: stakingAbi, data })
        if (call.functionName === "withdrawalQueues") {
          if (options.unavailable === "cooldown") return Response.json({ id: request.id, jsonrpc: "2.0", error: { code: -32602, message: "Queue unavailable" } })
          result = encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalQueues", result: [1n, 2n] })
        }
        else if (call.functionName === "withdrawalNodes") result = encodeFunctionResult({ abi: stakingAbi, functionName: "withdrawalNodes", result:
          call.args[1] === 1n ? [10n, BigInt(timestamp), 0n, 2n] : [10n, BigInt(timestamp + 1), 1n, 0n] })
        else if (call.functionName === "stakes") result = encodeFunctionResult({ abi: stakingAbi, functionName: "stakes", result: options.stake ?? 10n })
        else if (call.functionName === "isValidator") result = encodeFunctionResult({ abi: stakingAbi, functionName: "isValidator", result: options.registered ?? false })
        else assert.fail("Unexpected contract read")
      }
    } else assert.fail("Unexpected RPC method")
    return Response.json({ id: request.id, jsonrpc: "2.0", result })
  })
}

test("sources use one finalized block; cooldown boundaries, real Merkle proof and registered stake determine conditions", async () => {
  const mocked = transport()
  try {
    const { events, validators } = await walletConditions(env, sub)
    assert.deepEqual(events.map(e => e.trigger), ["cooldown", "rewards", "deregistered"])
    assert.equal(events[0]!.key, "cooldown:1")
    assert.match(events[2]!.key, /:80$/)
    assert.deepEqual(validators, [validator])
  } finally { mocked.mock.restore() }
})
test("stale roots, fully claimed rewards, zero stakes and registered validators cannot produce false alerts", async () => {
  for (const options of [{ root: keccak256(encodePacked(["uint256"], [1n])), stake: 0n }, { claimed: 100n, registered: true }]) {
    const mocked = transport(options)
    try { assert.deepEqual((await walletConditions(env, sub)).events.map(e => e.trigger), ["cooldown"]) }
    finally { mocked.mock.restore() }
  }
})
test("wrong chains fail before condition evaluation", async () => {
  const mocked = transport({ wrongChain: true })
  try { await assert.rejects(walletConditions(env, sub), /mismatch/) }
  finally { mocked.mock.restore() }
})
test("normal Mainnet finality permits alerts while stalled finality fails closed", async () => {
  const normal = transport({ finalizedAge: 17 * 60 })
  try {
    const result = await walletConditions(env, sub)
    assert.deepEqual(result.events.map(e => e.trigger), ["cooldown", "rewards", "deregistered"])
    assert.equal(result.failed, 0)
  } finally { normal.mock.restore() }
  const stalled = transport({ finalizedAge: 31 * 60 })
  try { await assert.rejects(walletConditions(env, sub), /Mainnet head stale/) }
  finally { stalled.mock.restore() }
})
test("deregistration keys stay stable through stake activity and change on a new registration episode", async () => {
  const keys: string[] = []
  for (const options of [
    { registeredAtBlock: "80", lastUpdatedAtBlock: "90" },
    { registeredAtBlock: "80", lastUpdatedAtBlock: "95" },
    { registeredAtBlock: "96", lastUpdatedAtBlock: "99" },
  ]) {
    const mocked = transport(options)
    try { keys.push((await walletConditions(env, sub)).events.find(e => e.trigger === "deregistered")!.key) }
    finally { mocked.mock.restore() }
  }
  assert.equal(keys[0], keys[1])
  assert.notEqual(keys[1], keys[2])
})
test("independent sources preserve valid alerts and report failed evaluations", async () => {
  for (const unavailable of ["cooldown", "rewards", "delegations"] as const) {
    const mocked = transport({ unavailable })
    try {
      const result = await walletConditions(env, sub)
      const failedTrigger = unavailable === "delegations" ? "deregistered" : unavailable
      assert.deepEqual(result.events.map(e => e.trigger), ["cooldown", "rewards", "deregistered"].filter(t => t !== failedTrigger))
      assert.deepEqual(result.validators, unavailable === "delegations" ? [] : [validator])
      assert.equal(result.failed, 1)
    } finally { mocked.mock.restore() }
  }
})
test("stale delegation indexing cannot manufacture deregistration or discard verified withdrawals and rewards", async () => {
  const mocked = transport({ stale: true })
  try {
    const result = await walletConditions(env, sub)
    assert.deepEqual(result.events.map(e => e.trigger), ["cooldown", "rewards"])
    assert.deepEqual(result.validators, [])
    assert.equal(result.failed, 1)
  } finally { mocked.mock.restore() }
})


test("Gnosis source commits dense ranges across polls, recovers an old SID and refuses changed finalized history", async () => {
  const db = new SqlDatabase(); await db.setup()
  const first = CONTRACTS.aegisFrostCoordinator.deployBlock
  const timestamp = Math.floor(Date.now() / 1000)
  const root = numberToHex(1, { size: 32 })
  const hash = numberToHex(2, { size: 32 })
  const shared = indexedEvent("aegisFrostCoordinator", "SignShared")
  const completed = indexedEvent("aegisFrostCoordinator", "SignCompleted")
  const attested = indexedEvent("aegisConsensus", "TransactionAttested")
  const log = (abi: AbiEvent, block: bigint, index: number, topics: ReturnType<typeof encodeEventTopics>, values: readonly unknown[]) => ({
    address: abi.name === "TransactionAttested" ? CONTRACTS.aegisConsensus.address : CONTRACTS.aegisFrostCoordinator.address,
    blockNumber: numberToHex(block), blockHash: hash, logIndex: numberToHex(index), transactionIndex: "0x0",
    transactionHash: hash, removed: false, topics, data: encodeAbiParameters(abi.inputs.filter(input => !input.indexed), values),
  })
  let late = false, changedHash = false, saturated = false
  const ranges: number[] = []
  const mocked = mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init!.body))
    let result: unknown
    if (request.method === "eth_chainId") result = numberToHex(CHAINS.gnosis.id)
    else if (request.method === "eth_getBlockByNumber") result = {
      number: request.params[0] === "finalized" ? numberToHex(first + (late ? 100_000n : 10n)) : request.params[0],
      hash: changedHash ? root : hash, timestamp: numberToHex(timestamp), transactions: [],
    }
    else if (request.method === "eth_getLogs") {
      const from = BigInt(request.params[0].fromBlock), to = BigInt(request.params[0].toBlock)
      ranges.push(Number(to - from + 1n))
      const logs = []
      for (let block = from; block <= to && block <= first + 10n; block++) {
        for (let i = 0; i < (saturated ? 1001 : 1000); i++) {
          const sid = numberToHex((block - first) * 1000n + BigInt(i + 1), { size: 32 })
          logs.push(log(shared, block, i, encodeEventTopics({ abi: [shared], eventName: "SignShared", args: { sid, selectionRoot: root } }),
            [CONTRACTS.aegisConsensus.address, 1n]))
        }
      }
      if (late && from <= first + 100_000n && to >= first + 100_000n) {
        logs.push(log(completed, first + 100_000n, 0, encodeEventTopics({ abi: [completed], eventName: "SignCompleted", args: { sid: root, selectionRoot: root } }),
          [{ r: { x: 1n, y: 1n }, z: 1n }]))
        logs.push(log(attested, first + 100_000n, 1, encodeEventTopics({ abi: [attested], eventName: "TransactionAttested",
          args: { safeTxHash: root, safeId: root, oracle: CONTRACTS.aegisConsensus.address } }),
          [1n, root, root, { r: { x: 1n, y: 1n }, z: 1n }]))
      }
      result = logs
    } else assert.fail("Unexpected Gnosis method")
    return Response.json({ id: request.id, jsonrpc: "2.0", result })
  })
  const saved = async () => (await db.request<{ value: Chronology }[]>("alerts_state?key=eq.aegis"))[0]!.value
  try {
    let holder = crypto.randomUUID()
    await db.rpc("lock_run", { holder })
    let result = await advanceChronology({ ...env, GNOSIS_RPC_URL: "https://gnosis.test" }, initialChronology(), db, holder)
    assert.equal(result.current, false)
    assert.equal(result.state.cursor, (first + 9n).toString())
    assert.ok(ranges.some(size => size > 1)) // Dense requests shrink to complete-block batches.
    assert.deepEqual(result.state.pending, {})
    await db.rpc("lock_run", { holder, release: true })
    holder = crypto.randomUUID()
    await db.rpc("lock_run", { holder })
    result = await advanceChronology({ ...env, GNOSIS_RPC_URL: "https://gnosis.test" }, await saved(), db, holder)
    assert.equal(result.current, true)
    assert.equal((await db.pg.query<{ count: number }>("select count(*)::int as count from alerts_ceremonies")).rows[0]!.count, 11_000)
    late = true
    // Backfill still obeys ten ranges per invocation across the long attestation delay.
    for (let i = 0; i < 5; i++) result = await advanceChronology({ ...env, GNOSIS_RPC_URL: "https://gnosis.test" }, await saved(), db, holder)
    assert.equal(result.current, true)
    assert.deepEqual(result.state.rounds[0]!.present, [CONTRACTS.aegisConsensus.address.toLowerCase()])
    assert.equal(result.state.members[CONTRACTS.aegisConsensus.address.toLowerCase()]!.misses, 0)
    const before = await saved()
    changedHash = true
    await assert.rejects(advanceChronology({ ...env, GNOSIS_RPC_URL: "https://gnosis.test" }, before, db, holder), /checkpoint changed/)
    assert.deepEqual(await saved(), before)
    changedHash = false; saturated = true; late = false
    await assert.rejects(advanceChronology({ ...env, GNOSIS_RPC_URL: "https://gnosis.test" }, initialChronology(), db, holder), /Single block/)
    assert.deepEqual(await saved(), before)
  } finally { mocked.mock.restore(); await db.pg.close() }
})

for (const scenario of ["archive", "provider", "provider-single-block", "unrelated-provider"] as const) {
  test(`chronology range recovery: ${scenario}`, async () => {
    const db = new SqlDatabase(); await db.setup()
    const holder = crypto.randomUUID()
    await db.rpc("lock_run", { holder })
    const first = CONTRACTS.aegisFrostCoordinator.deployBlock
    const now = Math.floor(Date.now() / 1000)
    const root = numberToHex(1, { size: 32 }), hash = numberToHex(2, { size: 32 })
    const signer = CONTRACTS.aegisConsensus.address.toLowerCase() as Hex
    const count = scenario === "archive" ? 200 : scenario === "provider-single-block" ? 1 : 11
    const end = first + BigInt(count - 1)
    const ranges: number[] = []
    if (scenario === "archive") {
      // Each ceremony fits 64 KiB, but recovering all 200 exceeds the SQL 8 MiB bound.
      const ceremony = { root, shares: { [root]: [signer], losing: Array.from({ length: 1015 }, () => signer) } }
      assert.ok(JSON.stringify(ceremony).length < 64 * 1024)
      const rows = Object.fromEntries(Array.from({ length: count }, (_, i) => [numberToHex(i + 1, { size: 32 }), ceremony]))
      await db.pg.query("insert into alerts_ceremonies select key,value from jsonb_each($1::jsonb)", [JSON.stringify(rows)])
      assert.equal(await db.rpc("load_ceremonies", { holder, expected_revision: 0, sids: Object.keys(rows) }), null)
    }
    const event: AbiEvent = scenario === "archive" ? indexedEvent("aegisConsensus", "TransactionAttested") : indexedEvent("aegisFrostCoordinator", "SignShared")
    const mocked = mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init!.body))
      let result: unknown
      if (request.method === "eth_chainId") result = numberToHex(CHAINS.gnosis.id)
      else if (request.method === "eth_getBlockByNumber") result = {
        number: request.params[0] === "finalized" ? numberToHex(end) : request.params[0], hash,
        timestamp: numberToHex(now), transactions: [],
      }
      else if (request.method === "eth_getLogs") {
        const from = BigInt(request.params[0].fromBlock), to = BigInt(request.params[0].toBlock)
        ranges.push(Number(to - from + 1n))
        if (scenario === "unrelated-provider" || scenario === "provider-single-block" || (scenario === "provider" && to - from >= 10n)) {
          return Response.json({ id: request.id, jsonrpc: "2.0", error: { code: -32005,
            message: scenario === "unrelated-provider" ? "rate limit exceeded" : "query returned more than 1000 results" } })
        }
        const logs = []
        for (let block = from; block <= to; block++) for (let index = 0; index < (scenario === "archive" ? 1 : 100); index++) {
          const sid = numberToHex((block - first) * BigInt(scenario === "archive" ? 1 : 100) + BigInt(index + 1), { size: 32 })
          const topics = scenario === "archive"
            ? encodeEventTopics({ abi: [event], eventName: "TransactionAttested", args: { safeTxHash: root, safeId: root, oracle: signer } })
            : encodeEventTopics({ abi: [event], eventName: "SignShared", args: { sid, selectionRoot: root } })
          const values = scenario === "archive" ? [1n, root, sid, { r: { x: 1n, y: 1n }, z: 1n }] : [signer, 1n]
          logs.push({ address: signer, blockNumber: numberToHex(block), blockHash: hash, logIndex: numberToHex(index),
            transactionIndex: "0x0", transactionHash: hash, removed: false, topics,
            data: encodeAbiParameters(event.inputs.filter(input => !input.indexed), values) })
        }
        result = logs
      } else assert.fail("Unexpected Gnosis request")
      return Response.json({ id: request.id, jsonrpc: "2.0", result })
    })
    try {
      if (scenario === "provider-single-block" || scenario === "unrelated-provider") {
        await assert.rejects(advanceChronology(env, initialChronology(), db, holder))
        assert.ok(ranges.every(size => size === count), "non-capacity failures must not shrink ranges")
        assert.deepEqual(await db.request("alerts_state?key=eq.aegis"), [])
      } else {
        const result = await advanceChronology(env, initialChronology(), db, holder)
        assert.equal(result.current, true)
        assert.equal(result.state.cursor, end.toString())
        assert.ok(ranges.some(size => size < count))
        if (scenario === "archive") {
          assert.equal(result.state.rounds.length, 200)
          assert.ok(result.state.rounds.every(round => round.present.length === 1 && round.present[0] === signer))
          assert.equal((await db.pg.query("select * from alerts_ceremonies where not ceremony ? 'counted'")).rows.length, 0)
        } else assert.equal((await db.pg.query("select * from alerts_ceremonies")).rows.length, 1100)
      }
    } finally { mocked.mock.restore(); await db.pg.close() }
  })
}

test("missing registration uses the first observation as a stable alert key", async () => {
  const keys: string[] = []
  for (const options of [
    { registeredAtBlock: null, firstSeenAtBlock: "70", lastUpdatedAtBlock: "90" },
    { registeredAtBlock: null, firstSeenAtBlock: "70", lastUpdatedAtBlock: "95" },
    { registeredAtBlock: "96", firstSeenAtBlock: "70", lastUpdatedAtBlock: "99" },
  ]) {
    const mocked = transport(options)
    try {
      const result = await walletConditions(env, sub)
      assert.equal(result.failed, 0)
      const event = result.events.find(e => e.trigger === "deregistered")!
      assert.match(event.body, /is not registered/)
      keys.push(event.key)
    } finally { mocked.mock.restore() }
  }
  assert.equal(keys[0], `deregistered:${validator}:70`)
  assert.equal(keys[0], keys[1])
  assert.equal(keys[2], `deregistered:${validator}:96`)
})
