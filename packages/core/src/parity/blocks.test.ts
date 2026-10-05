import { test } from "node:test"
import assert from "node:assert/strict"
import { blockAtTimestamp } from "./blocks.js"

// A made-up chain: block n at 1000 + 5n seconds, with slots 103 and 104 missed, so block 103
// lands at 1525 instead of 1515. A missed slot is where "first" and "last" differ.
const timestampOf = async (n: bigint) => 1000n + 5n * n + (n >= 103n ? 10n : 0n)
const at = (target: bigint, side: "first" | "last") =>
  blockAtTimestamp({ timestampOf, lo: 10n, hi: 500n, target, side })

test("on a block's exact second, first and last agree", async () => {
  assert.equal(await at(1500n, "first"), 100n)
  assert.equal(await at(1500n, "last"), 100n)
})

test("inside a missed slot, last is the block before and first the block after", async () => {
  assert.equal(await at(1515n, "last"), 102n)
  assert.equal(await at(1515n, "first"), 103n)
})

test("a head before the instant is refused, not clamped", async () => {
  await assert.rejects(at(1_000_000n, "last"), /node is behind/)
})

test("an instant before the search floor is refused", async () => {
  await assert.rejects(at(1000n, "first"), /before the search floor/)
})
