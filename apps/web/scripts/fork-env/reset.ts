/**
 * `pnpm fork:reset`: the chain back to the baseline `fork:up` took its snapshot of, with the
 * wallet funded and the test amount to claim. A revert consumes the snapshot, so a new one is
 * taken from the same state. When the snapshot is gone, or Anvil is not up, the same steps as
 * `fork:up` rebuild the baseline from scratch.
 */
import type { Hex } from "viem"
import { anvilStatus, stopAnvil } from "./anvil"
import { ensureAnvil } from "./baseline"
import { revert, snapshot } from "./chain"
import { SETUP_RECORD, command, say, writeRecord, type SetupRecord } from "./processes"

await command(async () => {
  console.log("\n  Manual QA fork: reset\n")
  const status = await anvilStatus()
  if (status.state !== "ready") {
    say("Reset", "no baseline to go back to; building it")
    await ensureAnvil()
  } else {
    const setup: SetupRecord = status.setup
    if (await revert(setup.snapshotId as Hex)) {
      setup.snapshotId = await snapshot()
      writeRecord(SETUP_RECORD, setup)
      say("Reset", `the chain is back at the baseline; next snapshot ${setup.snapshotId}`)
    } else {
      say("Reset", "the baseline snapshot is gone; restarting Anvil from scratch")
      await stopAnvil()
      await ensureAnvil()
    }
  }
  console.log(`
  In MetaMask, clear the activity data of the imported account: Settings, Advanced, Clear
  activity tab data. Otherwise it reuses nonces the chain no longer has.
`)
})
