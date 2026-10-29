import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { decodeFunctionData, encodeFunctionResult, encodePacked, keccak256, numberToHex, type Hex } from "viem"
import { CHAINS, CONTRACTS, merkleDropAbi, stakingAbi } from "@cobuilders/safenet-core"
import { walletConditions } from "./sources.js"
import type { Env, Subscription } from "./types.js"

const wallet = CONTRACTS.safeToken.address
const validator = CONTRACTS.staking.address
const leaf = keccak256(encodePacked(["address", "uint256"], [wallet, 100n]))
const env: Env = { APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused",
  MAINNET_RPC_URL: "https://rpc.test", REWARDS_BASE_URL: "https://proof.test", SUBGRAPH_URL_MAINNET: "https://graph.test" }
const sub: Subscription = { id: crypto.randomUUID(), wallet, triggers: ["cooldown", "rewards", "deregistered"], participation: 75, missed: 3,
  channel: { kind: "telegram" }, telegram_chat: null, status: "unverified", last_delivery: null }
function transport(options: { stale?: boolean; root?: Hex; claimed?: bigint; registered?: boolean; stake?: bigint; wrongChain?: boolean;
  finalizedAge?: number; registeredAtBlock?: string; lastUpdatedAtBlock?: string;
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
      assert.equal(body.variables.wallet, wallet.toLowerCase())
      assert.equal(body.variables.block.number, 100)
      return Response.json({ data: { _meta: { block: { number: 100, timestamp: options.stale ? 1 : timestamp }, hasIndexingErrors: false },
        delegations: [{ id: "position", validator: { id: validator, registeredAtBlock: options.registeredAtBlock ?? "80",
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
