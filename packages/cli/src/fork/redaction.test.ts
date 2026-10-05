import { test } from "node:test"
import assert from "node:assert/strict"
import { inspect } from "node:util"
import { findRewardsClaimer } from "./chain.js"

// Runs under `pnpm test` as well as test:fork: it needs no Anvil and no network, only a refused
// connection on a local port.

test("a failed archive read in the fork setup carries no part of the endpoint URL", async () => {
  const token = "FAKE_TOKEN_5f3c9d"
  const err = await findRewardsClaimer(`http://127.0.0.1:1/v2/${token}`).then(
    () => assert.fail("the read from a closed port succeeded"),
    (e: unknown) => e,
  )
  assert.ok(err instanceof Error)
  assert.match(err.message, /^reading the MerkleDrop root from the archive endpoint failed: /)
  assert.equal(err.cause, undefined)
  // What a test reporter prints: the message, the stack, every own field, and any cause.
  for (const text of [err.message, String(err.stack), inspect(err, { depth: 10, showHidden: true })]) {
    assert.ok(!text.includes(token), text)
    assert.ok(!text.includes("127.0.0.1:1"), text)
  }
})
