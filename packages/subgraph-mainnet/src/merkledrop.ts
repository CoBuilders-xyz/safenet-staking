import { Claimed, MerkelRootUpdated } from "../generated/MerkleDrop/MerkleDrop"
import { RewardClaim, RewardAccount, RewardPeriod } from "../generated/schema"
import { network, dayData, ZERO } from "./shared"

/**
 * A claim on the MerkleDrop.
 *
 * The event's `amount` is what THIS claim paid, not the account's cumulative total. Checked
 * against the chain on 2026-10-04: one account's seven event amounts rise and fall (18, 8, 8, 15,
 * 15, 6, 17 SAFE) and sum to `cumulativeClaimed(account)` on the contract, and the amounts of
 * all 326 claims sum to allocated minus the live MerkleDrop balance. metrics-poc.ts sums them the
 * same way. Reading the field as cumulative made 141 of those claims negative.
 *
 * So the network total is the plain sum, and the per-account running total is kept here to
 * give each RewardClaim the account's cumulative figure after it.
 *
 * The differential test checks the result: allocated minus claimed equals the live MerkleDrop balance.
 */
export function handleClaimed(event: Claimed): void {
  const account = event.params.account.toHexString()

  let a = RewardAccount.load(account)
  if (a == null) {
    a = new RewardAccount(account)
    a.account = event.params.account
    a.cumulativeClaimed = ZERO
    a.claimCount = 0
    a.firstClaimAtTimestamp = event.block.timestamp
  }

  const paid = event.params.amount
  const cumulative = a.cumulativeClaimed.plus(paid)

  const c = new RewardClaim(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString(),
  )
  c.account = event.params.account
  c.cumulativeAmount = cumulative
  c.amount = paid
  c.blockNumber = event.block.number
  c.timestamp = event.block.timestamp
  c.transactionHash = event.transaction.hash
  c.save()

  a.cumulativeClaimed = cumulative
  a.claimCount = a.claimCount + 1
  a.lastClaimAtTimestamp = event.block.timestamp
  a.save()

  const n = network()
  n.rewardsClaimed = n.rewardsClaimed.plus(paid)
  n.save()

  const day = dayData(event.block, n)
  day.rewardsClaimed = day.rewardsClaimed.plus(paid)
  day.save()
}

/**
 * A rewards distribution: the Merkle root was replaced.
 *
 * The handler name follows the contract's spelling. "Merkel" is a typo in the deployed
 * bytecode, and topic0 only matches the misspelling, so correcting it here would index
 * nothing and look correct.
 *
 * Fifteen of these had occurred by 2026-09-29, matching the reward schedule.
 */
export function handleMerkelRootUpdated(event: MerkelRootUpdated): void {
  const n = network()
  const period = n.rewardPeriods + 1

  const p = new RewardPeriod(period.toString())
  p.period = period
  p.previousRoot = event.params.oldRoot
  p.root = event.params.newRoot
  p.blockNumber = event.block.number
  p.timestamp = event.block.timestamp
  p.transactionHash = event.transaction.hash
  // Claims made BEFORE this root took effect. The difference against the next period is what
  // stakers took while this root was in force.
  p.cumulativeClaimedAtStart = n.rewardsClaimed
  p.save()

  n.rewardPeriods = period
  n.currentRoot = event.params.newRoot
  n.save()
}
