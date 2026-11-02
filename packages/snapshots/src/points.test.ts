import assert from "node:assert/strict"
import { test } from "node:test"
import { SEF_DATA, SUBGRAPH_STALE_AFTER_SECONDS } from "@cobuilders/safenet-core"
import { CONFIRMATIONS, choosePoints, utcDay, type PointsIo } from "./points.js"
import type { Query } from "./subgraph.js"

const NOW = new Date("2026-10-27T22:20:00Z")
const NOW_S = BigInt(NOW.getTime() / 1000)
const hashOf = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`

/** A subgraph that indexed to `head`, holds every block up to it, and answers its hash for each. */
function subgraph(head: bigint, options: { errors?: boolean; age?: bigint; timestampOf?: (n: bigint) => bigint } = {}): Query {
  const ts = options.timestampOf ?? ((n: bigint) => NOW_S - (options.age ?? 0n) - (head - n) * 12n)
  return async (query) => {
    const m = /hash: "(0x[0-9a-f]+)"/.exec(query)
    const n = m ? BigInt(m[1]!) : head
    if (n > head) throw new Error("Failed to decode `block.hash` value: `no block with that hash found`")
    return { _meta: { block: { number: Number(n), hash: hashOf(n), timestamp: Number(ts(n)) }, deployment: "Qm", hasIndexingErrors: options.errors ?? false } }
  }
}

function io(over: Partial<PointsIo> = {}): PointsIo {
  return {
    mainnet: subgraph(1_000n),
    gnosis: subgraph(5_000n),
    rpc: { head: async () => 1_005n, block: async (n) => ({ hash: hashOf(n), timestamp: NOW_S - (1_000n - n) * 12n }) },
    lastCommit: async (url) => ({
      sha: url === SEF_DATA.rewardsLatestCommits ? "b".repeat(40) : "a".repeat(40),
      publishedAt: new Date("2026-10-27T21:00:00Z"),
    }),
    now: NOW,
    ...over,
  }
}

test("the Mainnet block sits below the lower of the two heads, and the Gnosis block is its subgraph's head", async () => {
  const p = await choosePoints(io())
  assert.equal(p.mainnet.block, 1_000n - CONFIRMATIONS)
  assert.equal(p.gnosis.block, 5_000n)
  const slowRpc = await choosePoints(io({ rpc: { ...io().rpc, head: async () => 990n } }))
  assert.equal(slowRpc.mainnet.block, 990n - CONFIRMATIONS)
})

test("the day is the UTC day of the Mainnet block", async () => {
  assert.equal(utcDay(BigInt(Date.parse("2026-10-27T23:59:59Z") / 1000)), "2026-10-27")
  assert.equal(utcDay(BigInt(Date.parse("2026-10-28T00:00:00Z") / 1000)), "2026-10-28")
  assert.equal((await choosePoints(io())).day, "2026-10-27")
})

test("each of SEF's three files is pinned to the commit that last wrote it", async () => {
  const p = await choosePoints(io())
  assert.deepEqual(p.sef.map((s) => [s.path, s.commit[0]]), [
    ["validator-info.json", "a"], ["network-info.json", "a"], ["rewards/latest.json", "b"],
  ])
})

test("a subgraph with indexing errors stops the day", async () => {
  await assert.rejects(choosePoints(io({ gnosis: subgraph(5_000n, { errors: true }) })), /Gnosis subgraph reports indexing errors/)
})

test("a subgraph whose head is older than core's threshold stops the day", async () => {
  const age = BigInt(SUBGRAPH_STALE_AFTER_SECONDS) + 60n
  await assert.rejects(choosePoints(io({ mainnet: subgraph(1_000n, { age }) })), /Mainnet subgraph's head, block 1000, is \d+ s old/)
})

test("a subgraph that does not hold the RPC's block stops the day", async () => {
  const otherFork = { ...io().rpc, block: async (n: bigint) => ({ hash: hashOf(n + 1_000_000n), timestamp: 0n }) }
  await assert.rejects(choosePoints(io({ rpc: otherFork })), /no block with that hash/)
})

test("a subgraph that places the block at another time stops the day", async () => {
  const shifted = subgraph(1_000n, { timestampOf: () => 1n })
  const fresh: Query = async (q) => (q.includes("hash:") ? shifted(q) : subgraph(1_000n)(q))
  await assert.rejects(choosePoints(io({ mainnet: fresh })), /places the RPC's block/)
})
