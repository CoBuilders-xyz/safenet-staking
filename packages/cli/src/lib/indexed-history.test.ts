import { test } from "node:test"
import assert from "node:assert/strict"
import type { PublicClient } from "viem"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { fakeContext, STAKER, fakeRoot, BLOCK, BLOCK_TIME } from "../test-support.js"
import { indexedClaims, indexedWithdrawals } from "./indexed-history.js"
import { rewardsHistory } from "./rewards.js"
import { networkWithdrawals } from "./withdrawals.js"
import { formatSafe } from "../commands/format.js"
import { run } from "../cli.js"
import { fakeRuntime } from "../test-support.js"

const HEAD = BLOCK + 2n
const AMOUNT = 12345678901234567890123456789n
const HASH = fakeRoot(900)
function claim(i: number) {
  const transactionHash = fakeRoot(i + 1)
  return { id: `${transactionHash}-${i}`, account: STAKER.toLowerCase(), amount: String(AMOUNT),
    blockNumber: String(BLOCK), timestamp: String(BLOCK_TIME), transactionHash }
}
function withdrawal(i: number) {
  return { id: String(i + 1), staker: STAKER.toLowerCase(), amount: String(AMOUNT), claimed: false,
    initiatedAtBlock: String(BLOCK), initiatedAtTimestamp: String(BLOCK_TIME), initiatedTxHash: fakeRoot(i + 1),
    claimedAtBlock: null as string | null, claimedAtTimestamp: null as string | null, claimedTxHash: null as string | null }
}
function fixture(n = 2) {
  const base = fakeContext()
  const claims = Array.from({ length: n }, (_, i) => claim(i))
  const withdrawals = Array.from({ length: n }, (_, i) => withdrawal(i))
  const queries: string[] = []
  const ranges: [bigint, bigint][] = []
  const client = {
    ...base.client,
    getBlockNumber: async () => HEAD,
    getBlock: async (p?: { blockNumber?: bigint }) => ({
      number: p?.blockNumber ?? HEAD, hash: HASH,
      timestamp: BLOCK_TIME + ((p?.blockNumber ?? HEAD) - BLOCK) * 12n,
    }),
    readContract: async () => BigInt(n) * AMOUNT,
    getLogs: async (p: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([p.fromBlock, p.toBlock])
      if (p.fromBlock <= BLOCK) throw new Error("historical logs unavailable")
      return []
    },
  } as unknown as PublicClient
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const q = JSON.parse(String(init?.body)).query as string
    queries.push(q)
    const answer = (data: unknown) => Response.json({ data })
    if (q.includes("hasIndexingErrors")) return answer({ _meta: {
      block: { number: Number(BLOCK), hash: HASH, timestamp: Number(BLOCK_TIME) }, hasIndexingErrors: false,
    } })
    if (q.includes("rewardAccount(")) return answer({ rewardAccount: n ? { claimCount: n, cumulativeClaimed: String(BigInt(n) * AMOUNT) } : null })
    if (q.includes("network(")) return answer({ network: { withdrawalCount: n, pendingWithdrawals: String(BigInt(n) * AMOUNT) } })
    const cursor = /id_gt: "([^"]*)"/.exec(q)?.[1] ?? ""
    const page = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : 1)
      .filter((r) => r.id > cursor).slice(0, 1000)
    if (q.includes("rewardClaims(")) return answer({ rewardClaims: page(claims) })
    if (q.includes("withdrawals(")) return answer({ withdrawals: page(withdrawals) })
    throw new Error("periods intentionally unavailable")
  }
  return { ctx: { ...base, client, fetch }, claims, withdrawals, queries, ranges }
}

test("pages all 1001 claims and withdrawals at one hash, without skip limits", async () => {
  const f = fixture(1001)
  assert.equal((await indexedClaims(f.ctx, STAKER, HEAD)).rows.length, 1001)
  assert.equal((await indexedWithdrawals(f.ctx, HEAD)).rows.length, 1001)
  assert.equal(f.queries.filter((q) => q.includes("rewardClaims(")).length, 2)
  assert.equal(f.queries.filter((q) => q.includes("withdrawals(")).length, 2)
  for (const q of f.queries.filter((q) => !q.includes("_meta"))) assert.ok(q.includes(`block: { hash: "${HASH}" }`))
})

test("newest 20 and --all retain the full count and exact wei totals, with numeric same-block log order", async () => {
  const f = fixture(1001)
  const history = await rewardsHistory(f.ctx, STAKER)
  assert.equal(history.count, 1001)
  assert.equal(history.claims.length, 20)
  assert.equal(history.limited, true)
  assert.equal(history.claims[0]?.transaction, claim(1000).transactionHash)
  assert.equal(history.totalClaimed, 1001n * AMOUNT)
  assert.equal(history.sumMatchesChain, true)
  assert.equal(history.claims[0]?.time?.toISOString(), new Date(Number(BLOCK_TIME) * 1000).toISOString())
  assert.match(history.source, /complete.*index lag 2 blocks, filled by RPC/)
  assert.equal((await rewardsHistory(f.ctx, STAKER, { limit: null })).claims.length, 1001)
  assert.equal(formatSafe(AMOUNT), "12,345,678,901.234567890123456789 SAFE")
  assert.ok(f.ranges.every(([from, to]) => from === BLOCK + 1n && to === HEAD))
})

test("genuine empty history and network return zero only after the chain agrees", async () => {
  const f = fixture(0)
  assert.equal((await rewardsHistory(f.ctx, STAKER)).count, 0)
  assert.equal((await networkWithdrawals(f.ctx)).count.value, 0)
  const inconsistent = { ...f.ctx, client: { ...f.ctx.client, readContract: async () => 1n } as unknown as PublicClient }
  await assert.rejects(rewardsHistory(inconsistent, STAKER), /History unavailable.*do not sum/)
})

test("recent initiations and claims close an indexed withdrawal and retain a new pending one", async () => {
  const f = fixture(2)
  const ctx = { ...f.ctx, client: { ...f.ctx.client, getLogs: async (p: { event: { name: string }; fromBlock: bigint }) => {
    assert.equal(p.fromBlock, BLOCK + 1n)
    return [{ args: { staker: STAKER, withdrawalId: p.event.name === "WithdrawalInitiated" ? 3n : 1n, amount: AMOUNT } }]
  } } as unknown as PublicClient }
  const w = await networkWithdrawals(ctx)
  assert.equal(w.initiated, 3)
  assert.equal(w.claimed, 1)
  assert.equal(w.count.value, 2)
  assert.equal(w.openSum, 2n * AMOUNT)
})

test("RPC tail claims merge without duplicating logs and include the boundary blocks", async () => {
  const f = fixture(1)
  const log = { blockNumber: HEAD, logIndex: 2, transactionHash: fakeRoot(999), args: { amount: AMOUNT } }
  const ctx = { ...f.ctx, client: { ...f.ctx.client, readContract: async () => 2n * AMOUNT,
    getLogs: async () => [log, log] } as unknown as PublicClient }
  const result = await rewardsHistory(ctx, STAKER)
  assert.equal(result.count, 2)
  assert.equal(result.claims[0]?.block, HEAD)
  assert.equal(result.claims[1]?.block, BLOCK)
})

for (const failure of ["timeout", "graphql", "http", "partial", "stale", "reorg", "indexing", "future"] as const) {
  test(`${failure} index fails explicitly when the full RPC scan also fails`, async () => {
    const f = fixture()
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const q = JSON.parse(String(init?.body)).query as string
      if (failure === "timeout") throw new DOMException("private-marker", "TimeoutError")
      if (failure === "graphql") return Response.json({ data: {}, errors: [{ message: "private-marker" }] })
      if (failure === "http") return new Response("private-marker", { status: 429 })
      if (failure === "partial" && q.includes("rewardClaims(")) return Response.json({ data: { rewardClaims: [claim(0)] } })
      const response = await f.ctx.fetch(url, init)
      if (!q.includes("hasIndexingErrors")) return response
      const body = await response.json()
      if (failure === "stale") { body.data._meta.block.number -= 100; body.data._meta.block.timestamp -= 1200 }
      if (failure === "reorg") body.data._meta.block.hash = fakeRoot(777)
      if (failure === "indexing") body.data._meta.hasIndexingErrors = true
      if (failure === "future") body.data._meta.block.number = Number(HEAD + 1n)
      return Response.json(body)
    }
    await assert.rejects(rewardsHistory({ ...f.ctx, fetch }, STAKER), (e: unknown) => {
      assert.match(String(e), /History unavailable.*No partial results returned/)
      assert.doesNotMatch(String(e), /private-marker/)
      if (failure === "stale") assert.match(String(e), /stale/)
      return true
    })
  })
}

test("failed index uses the complete RPC scan and its original source", async () => {
  const f = fakeContext({ subgraph: "down" })
  assert.equal((await rewardsHistory(f, STAKER)).count, 2)
  assert.equal((await networkWithdrawals(f)).count.value, 1)
  assert.match((await rewardsHistory(f, STAKER)).source, /^chain:/)
})

for (const mutation of ["duplicate", "missing", "invalid amount", "wrong account", "old block", "future time"] as const) {
  test(`rejects ${mutation} claims instead of plausible incomplete totals`, async () => {
    const f = fixture()
    if (mutation === "duplicate") f.claims[1] = { ...f.claims[0]! }
    if (mutation === "missing") f.claims.pop()
    if (mutation === "invalid amount") f.claims[0]!.amount = "1.5"
    if (mutation === "wrong account") f.claims[0]!.account = CONTRACTS.staking.address.toLowerCase()
    if (mutation === "old block") f.claims[0]!.blockNumber = String(CONTRACTS.merkleDrop.deployBlock - 1n)
    if (mutation === "future time") f.claims[0]!.timestamp = String(BLOCK_TIME + 1n)
    await assert.rejects(indexedClaims(f.ctx, STAKER, HEAD))
  })
}

test("claimed withdrawals require complete claim fields and valid time boundaries", async () => {
  const f = fixture()
  f.withdrawals[0]!.claimed = true
  await assert.rejects(indexedWithdrawals(f.ctx, HEAD), /do not match/)
  f.withdrawals[0]!.claimedAtBlock = String(BLOCK - 1n)
  f.withdrawals[0]!.claimedAtTimestamp = String(BLOCK_TIME - 12n)
  f.withdrawals[0]!.claimedTxHash = fakeRoot(888)
  await assert.rejects(indexedWithdrawals(f.ctx, HEAD), /do not match/)
})

test("invalid CLI address exits 2 and an unsupported RPC chain exits 1 without history queries", async () => {
  const rt = fakeRuntime()
  assert.equal(await run(["rewards", "history", "invalid", "--json"], rt), 2)
  const f = fixture()
  const ctx = { ...f.ctx, client: { ...f.ctx.client, getChainId: async () => 100 } as unknown as PublicClient }
  await assert.rejects(rewardsHistory(ctx, STAKER), /Ethereum Mainnet RPC/)
  await assert.rejects(networkWithdrawals(ctx), /Ethereum Mainnet RPC/)
  assert.equal(f.queries.length, 0)
})

test("an index ahead of the captured RPC head can serve the earlier requested snapshot", async () => {
  const f = fixture()
  const ctx = { ...f.ctx, fetch: (async (url, init) => {
    const q = JSON.parse(String(init?.body)).query as string
    if (q.includes("hasIndexingErrors")) return Response.json({ data: { _meta: {
      block: { number: Number(q.includes("_meta(block:") ? HEAD : HEAD + 1n), hash: HASH,
        timestamp: Number(BLOCK_TIME + (q.includes("_meta(block:") ? 2n : 3n) * 12n) }, hasIndexingErrors: false,
    } } })
    return f.ctx.fetch(url, init)
  }) as typeof fetch }
  const result = await rewardsHistory(ctx, STAKER)
  assert.equal(result.count, 2)
  assert.match(result.source, /index lag 0 blocks/)
  assert.equal(f.ranges.length, 0)
})

test("a duplicate page, even with a matching aggregate count, cannot loop or silently dedupe", async () => {
  const f = fixture(1001)
  const ctx = { ...f.ctx, fetch: (async (url, init) => {
    const q = JSON.parse(String(init?.body)).query as string
    if (q.includes('id_gt: "0x')) return Response.json({ data: { rewardClaims: f.claims.slice(0, 1000) } })
    return f.ctx.fetch(url, init)
  }) as typeof fetch }
  await assert.rejects(indexedClaims(ctx, STAKER, HEAD), /pagination did not advance/)
})
