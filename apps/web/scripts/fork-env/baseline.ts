/**
 * The steps `fork:up` and `fork:reset` share: an Anvil of ours, at the wanted block, holding the
 * baseline, with a snapshot to come back to.
 */
import { formatEther } from "viem"
import { anvilStatus, foreignPort, startAnvil, stopAnvil } from "./anvil"
import { chain, establishBaseline, testAccount } from "./chain"
import { ANVIL_LOG, SETUP_RECORD, say, writeRecord, type SetupRecord } from "./processes"
import { writeRewards } from "./rewards"
import { ANVIL_URL, FORK_BLOCK, REWARDS_DIR, SEF_SOURCE, TEST_AMOUNT, TEST_BALANCE } from "./settings"

/** The source of SEF's files, as the messages name it. */
export const sefSourceLabel = SEF_SOURCE.ref === "main" ? "SEF's live files" : `SEF's files at commit ${SEF_SOURCE.ref.slice(0, 7)}`

/** Anvil answering at the wanted block with the baseline in place. Starts and sets it up if not. */
export async function ensureAnvil(): Promise<SetupRecord> {
  const status = await anvilStatus()
  switch (status.state) {
    case "ready":
      say("Anvil", `answers on ${ANVIL_URL} at block ${status.setup.block}, baseline in place`)
      return status.setup
    case "foreign":
      throw foreignPort()
    case "stale":
      say("Anvil", `restarting: ${status.why}`)
      await stopAnvil()
      break
    case "absent":
      break
  }

  say("Anvil", `starting a fork of Mainnet at block ${FORK_BLOCK} on ${ANVIL_URL}, log in ${ANVIL_LOG}`)
  await startAnvil()

  say("Rewards", `listing every claimer on Mainnet and reading its proof from ${sefSourceLabel}`)
  const rewards = await writeRewards(chain, SEF_SOURCE, testAccount(), TEST_AMOUNT, REWARDS_DIR)
  say("Rewards", `${rewards.carriedOver} claimers carried over, ${rewards.skipped} skipped, root ${rewards.root}`)
  if (!rewards.sourceRootMatchesFork) {
    say("Rewards", `the root ${sefSourceLabel} publish is not the one on chain at the fork block, so no real claimer is carried over.`)
    say("", "Set QA_SEF_DATA_COMMIT to a commit of SEF's data whose root is on chain at QA_FORK_BLOCK, or to main for the live files.")
  }

  say("Chain", "setting the root, funding the test account and the MerkleDrop, taking the baseline snapshot")
  const baseline = await establishBaseline(rewards.root)
  const setup: SetupRecord = {
    account: baseline.account,
    root: baseline.root,
    block: FORK_BLOCK.toString(),
    sefRef: SEF_SOURCE.ref,
    testAmount: TEST_AMOUNT.toString(),
    testBalance: TEST_BALANCE.toString(),
    balance: baseline.balance.toString(),
    claimable: baseline.claimable.toString(),
    carriedOver: rewards.carriedOver,
    skipped: rewards.skipped,
    sourceRootMatchesFork: rewards.sourceRootMatchesFork,
    snapshotId: baseline.snapshotId,
  }
  writeRecord(SETUP_RECORD, setup)
  say("Chain", `baseline in place: ${formatEther(baseline.balance)} SAFE in the wallet, ${formatEther(baseline.claimable)} SAFE to claim, snapshot ${baseline.snapshotId}`)
  return setup
}
