import { test } from "node:test"
import assert from "node:assert/strict"
import type { PublicClient } from "viem"
import { indexedEvent } from "@cobuilders/safenet-core"
import { fakeAddress } from "../test-support.js"
import { MIN_CHUNK, ScanError, scanLogs } from "./scan.js"

const event = indexedEvent("merkleDrop", "Claimed")
const address = fakeAddress(1)

/** A client that refuses ranges wider than `maxRange` and records every range it served. */
function rangeLimited(maxRange: bigint) {
  const served: [bigint, bigint][] = []
  const client = {
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (toBlock - fromBlock + 1n > maxRange) throw new Error("range too large")
      served.push([fromBlock, toBlock])
      return [{ blockNumber: fromBlock, args: {} }]
    },
  } as unknown as PublicClient
  return { ctx: { client, retryDelayMs: 0 }, served }
}

test("a scan shrinks the range on refusal and covers every block exactly once", async () => {
  const { ctx, served } = rangeLimited(5_000n)
  await scanLogs(ctx, { address, event, fromBlock: 100n, toBlock: 123_456n })
  assert.equal(served[0]?.[0], 100n)
  assert.equal(served.at(-1)?.[1], 123_456n)
  for (let i = 1; i < served.length; i++) {
    assert.equal(served[i]![0], served[i - 1]![1] + 1n, "a gap or an overlap between ranges")
  }
})

test("a scan returns the logs of every range", async () => {
  const { ctx, served } = rangeLimited(50_000n)
  const logs = await scanLogs(ctx, { address, event, fromBlock: 1n, toBlock: 120_000n })
  assert.equal(logs.length, served.length)
})

test("a scan that the endpoint refuses even at the smallest range fails, never skips", async () => {
  const { ctx } = rangeLimited(MIN_CHUNK - 1n)
  await assert.rejects(
    scanLogs(ctx, { address, event, fromBlock: 1n, toBlock: 10_000n }),
    (e: unknown) =>
      e instanceof ScanError &&
      /Could not read Claimed logs for blocks 1 to 1000/.test(e.message) &&
      e.cause instanceof Error && e.cause.message === "range too large",
  )
})

test("a history tail handles a one-block provider limit without gaps", async () => {
  const { ctx, served } = rangeLimited(1n)
  await scanLogs(ctx, { address, event, fromBlock: 100n, toBlock: 103n, minChunk: 1n })
  assert.deepEqual(served, [[100n, 100n], [101n, 101n], [102n, 102n], [103n, 103n]])
})

test("transient rate limits retry the same block, and persistent limits fail", async () => {
  let calls = 0
  const client = { getLogs: async () => {
    if (++calls < 3) throw new Error("429 rate limit")
    return []
  } } as unknown as PublicClient
  assert.deepEqual(await scanLogs({ client, retryDelayMs: 0 }, {
    address, event, fromBlock: 1n, toBlock: 1n, startChunk: 1n, minChunk: 1n,
  }), [])
  assert.equal(calls, 3)
  const denied = { getLogs: async () => { throw new Error("429 rate limit") } } as unknown as PublicClient
  await assert.rejects(scanLogs({ client: denied, retryDelayMs: 0 }, {
    address, event, fromBlock: 1n, toBlock: 1n, startChunk: 1n, minChunk: 1n,
  }), ScanError)
})
