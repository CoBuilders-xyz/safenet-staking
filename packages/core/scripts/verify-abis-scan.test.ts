import { test } from "node:test"
import assert from "node:assert/strict"
import { toEventSelector, type AbiEvent, type Address } from "viem"
import { indexedEvent } from "../src/abis.js"
import { CONTRACTS } from "../src/contracts.js"
import {
  CEILING, WINDOW, lastBlockBefore, scanBeforeClose, scanFromDeploy, scanRecent,
  type BlocksClient, type LogsClient,
} from "./verify-abis-scan.js"

// The scans against a mocked getLogs. No network: the chain here is a list of logs.

const address = CONTRACTS.consensus.address
const attested = indexedEvent("consensus", "TransactionAttested") as AbiEvent
const rolledOver = indexedEvent("consensus", "EpochRolledOver") as AbiEvent
const latest = 46_000_000n
const window = WINDOW.gnosis
const ceiling = CEILING.gnosis

interface ChainLog { address: Address; topic0: `0x${string}`; blockNumber: bigint }
interface Call { event: boolean; fromBlock: bigint; toBlock: bigint }

/** A getLogs that filters like a node: by address, by topic0 of the event, by range. */
function mockChain(logs: ChainLog[], opts: { maxRange?: bigint } = {}) {
  const calls: Call[] = []
  const client: LogsClient = {
    getLogs({ address: a, event, fromBlock, toBlock }) {
      calls.push({ event: event !== undefined, fromBlock, toBlock })
      if (opts.maxRange !== undefined && toBlock - fromBlock + 1n > opts.maxRange) {
        return Promise.reject(new Error("block range too large"))
      }
      const topic0 = event && toEventSelector(event)
      return Promise.resolve(
        logs.filter((l) =>
          l.address === a &&
          (topic0 === undefined || l.topic0 === topic0) &&
          l.blockNumber >= fromBlock && l.blockNumber <= toBlock),
      )
    },
  }
  return { client, calls }
}

const log = (event: AbiEvent, blockNumber: bigint): ChainLog =>
  ({ address, topic0: toEventSelector(event), blockNumber })

test("the ceilings sit above the windows on both chains", () => {
  assert.ok(CEILING.gnosis > WINDOW.gnosis)
  assert.ok(CEILING.mainnet > WINDOW.mainnet)
})

test("a quiet first window widens in doubling steps and reports how long ago the event was seen", async () => {
  // Nothing in the first two steps (2,000 and 4,000 blocks back), one log in the third.
  const { client, calls } = mockChain([log(attested, latest - 5_000n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)

  assert.equal(scan.status, "match")
  assert.equal(scan.logs, 1)
  assert.equal(scan.lastSeen, 5_000n)
  assert.equal(scan.depth, 8_000n)
  // Each step scans only the blocks the previous one did not, and the scan stops at the hit.
  assert.deepEqual(calls, [
    { event: true, fromBlock: latest - 2_000n, toBlock: latest },
    { event: true, fromBlock: latest - 4_000n, toBlock: latest - 2_001n },
    { event: true, fromBlock: latest - 8_000n, toBlock: latest - 4_001n },
  ])
})

test("a log inside the first window needs no widening", async () => {
  const { client, calls } = mockChain([log(attested, latest - 12n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)
  assert.equal(scan.status, "match")
  assert.equal(scan.lastSeen, 12n)
  assert.equal(calls.length, 1)
})

test("the steps neither overlap nor leave a gap at their boundary", async () => {
  const edge = await scanRecent(mockChain([log(attested, latest - 2_000n)]).client, address, attested, latest, window, ceiling)
  assert.equal(edge.lastSeen, 2_000n)
  assert.equal(edge.depth, 2_000n)
  const past = await scanRecent(mockChain([log(attested, latest - 2_001n)]).client, address, attested, latest, window, ceiling)
  assert.equal(past.lastSeen, 2_001n)
  assert.equal(past.depth, 4_000n)
})

test("last seen is the newest log of the step that found it", async () => {
  const { client } = mockChain([log(attested, latest - 7_000n), log(attested, latest - 5_000n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)
  assert.equal(scan.lastSeen, 5_000n)
})

test("no log up to the ceiling on a silent contract fails as NO ACTIVITY", async () => {
  // The only log sits one block beyond the ceiling.
  const { client, calls } = mockChain([log(attested, latest - ceiling - 1n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)

  assert.equal(scan.status, "NO ACTIVITY")
  assert.equal(scan.logs, 0)
  assert.equal(scan.lastSeen, undefined)
  assert.equal(scan.depth, ceiling)
  const filtered = calls.filter((c) => c.event)
  assert.equal(filtered.at(-1)?.fromBlock, latest - ceiling)
  assert.ok(calls.every((c) => c.fromBlock >= latest - ceiling), "never reads past the ceiling")
})

test("no log of the event up to the ceiling, while the contract emits others, fails as NO MATCH", async () => {
  const { client } = mockChain([log(rolledOver, latest - 150_000n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)
  assert.equal(scan.status, "NO MATCH")
  assert.equal(scan.depth, ceiling)
})

test("a wrong topic0 yields NO MATCH even when the real event fired one block ago", async () => {
  // A scratch copy of the registered signature with one parameter type altered.
  const real = attested
  const wrong: AbiEvent = { ...real, inputs: real.inputs.map((i) => (i.name === "epoch" ? { ...i, type: "uint32" } : i)) }
  assert.notEqual(toEventSelector(wrong), toEventSelector(real))

  const { client } = mockChain([log(real, latest - 1n)])
  const scan = await scanRecent(client, address, wrong, latest, window, ceiling)
  assert.equal(scan.status, "NO MATCH")
  assert.equal(scan.logs, 0)
})

test("a provider range cap shrinks the chunk instead of failing the scan", async () => {
  const { client, calls } = mockChain([log(attested, latest - 150_000n)], { maxRange: 10_000n })
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)
  assert.equal(scan.status, "match")
  assert.equal(scan.lastSeen, 150_000n)
  assert.ok(calls.some((c) => c.toBlock - c.fromBlock + 1n > 10_000n), "a request over the cap was tried")
})

test("near genesis the widening stops at block 0", async () => {
  const { client, calls } = mockChain([])
  const scan = await scanRecent(client, address, attested, 3_000n, window, ceiling)
  assert.equal(scan.status, "NO ACTIVITY")
  assert.ok(calls.every((c) => c.fromBlock >= 0n))
})

test("the deep scan reports the first log from the deploy block", async () => {
  const start = latest - 1_000_000n
  const { client } = mockChain([log(attested, start + 60_000n), log(attested, start + 10n)])
  const scan = await scanFromDeploy(client, address, attested, start, latest)
  assert.equal(scan.logs, 1)
  assert.equal(scan.firstSeen, start + 10n)
})

// A closed programme: the scan counts back from the programme's last block, the anchor, and never
// reads past it. The head sits well beyond the ceiling, as it does once a programme has been
// closed for longer than the ceiling spans.
const anchor = latest - 3n * ceiling

test("a closed programme's scan widens back from the anchor and reports a match before the end", async () => {
  const { client, calls } = mockChain([
    log(attested, anchor - 5_000n),
    // A log after the close is not the programme's, and the scan must not reach it.
    log(attested, anchor + 10n),
  ])
  const scan = await scanBeforeClose(client, address, attested, anchor, window, ceiling)

  assert.equal(scan.status, "match (programme ended)")
  assert.equal(scan.logs, 1)
  assert.equal(scan.lastSeen, 5_000n)
  assert.equal(scan.depth, 8_000n)
  assert.deepEqual(calls, [
    { event: true, fromBlock: anchor - 2_000n, toBlock: anchor },
    { event: true, fromBlock: anchor - 4_000n, toBlock: anchor - 2_001n },
    { event: true, fromBlock: anchor - 8_000n, toBlock: anchor - 4_001n },
  ])
})

test("a closed programme's event silent before the anchor fails as NO MATCH while the contract logged others", async () => {
  const { client, calls } = mockChain([log(rolledOver, anchor - 150_000n), log(attested, anchor + 1n)])
  const scan = await scanBeforeClose(client, address, attested, anchor, window, ceiling)
  assert.equal(scan.status, "NO MATCH")
  assert.equal(scan.depth, ceiling)
  assert.ok(calls.every((c) => c.toBlock <= anchor && c.fromBlock >= anchor - ceiling), "stays inside the ceiling before the anchor")
})

test("a closed programme's contract silent before the anchor fails as NO ACTIVITY, whatever it logged after", async () => {
  const { client } = mockChain([log(attested, anchor + 1n), log(rolledOver, latest - 1n)])
  const scan = await scanBeforeClose(client, address, attested, anchor, window, ceiling)
  assert.equal(scan.status, "NO ACTIVITY")
  assert.equal(scan.logs, 0)
})

test("the head-anchored scan of the same chain reports a closed contract as NO ACTIVITY", async () => {
  // Why the anchor exists: from the head, a programme closed longer ago than the ceiling is silent.
  const { client } = mockChain([log(attested, anchor - 5_000n)])
  const scan = await scanRecent(client, address, attested, latest, window, ceiling)
  assert.equal(scan.status, "NO ACTIVITY")
})

/** Blocks five seconds apart from `genesis`, as on Gnosis, counting the lookups. */
function mockBlocks(genesis: bigint) {
  let lookups = 0
  const client: BlocksClient = {
    getBlock({ blockNumber }) {
      lookups++
      return Promise.resolve({ timestamp: genesis + blockNumber * 5n })
    },
  }
  return { client, lookups: () => lookups }
}

test("the anchor is the last block stamped strictly before the close", async () => {
  const genesis = 1_600_000_000n
  // A block lands exactly on the close: it belongs to the next programme, so the one before is the anchor.
  const onTheSecond = mockBlocks(genesis)
  const closedAt = new Date(Number(genesis + 40_000_000n * 5n) * 1000)
  assert.equal(await lastBlockBefore(onTheSecond.client, closedAt, 1_000n, latest), 39_999_999n)
  assert.ok(onTheSecond.lookups() < 64, "a binary search, not a walk")

  // No block on the close: the anchor is the last one before it.
  const between = new Date(Number(genesis + 40_000_000n * 5n + 3n) * 1000)
  assert.equal(await lastBlockBefore(mockBlocks(genesis).client, between, 1_000n, latest), 40_000_000n)
})

test("the anchor search refuses a close the head has not reached", async () => {
  const genesis = 1_600_000_000n
  const future = new Date(Number(genesis + (latest + 10n) * 5n) * 1000)
  await assert.rejects(lastBlockBefore(mockBlocks(genesis).client, future, 1_000n, latest), /node is behind/)
})
