import { BigInt, log } from "@graphprotocol/graph-ts"
import {
  StakeIncreased,
  WithdrawalInitiated,
  WithdrawalClaimed,
  ValidatorUpdated,
} from "../generated/Staking/Staking"
import { Stake, Withdrawal, Delegation, Staker } from "../generated/schema"
import { network, validator, staker, dayData, ZERO } from "./shared"

export function handleStakeIncreased(event: StakeIncreased): void {
  const n = network()
  const v = validator(event.params.validator, event.block)

  // Whether this address is new, and whether it was staking anywhere, must be read BEFORE
  // the helpers create or update the rows.
  const stakerId = event.params.staker.toHexString()
  const isNewStaker = Staker.load(stakerId) == null
  const st = staker(event.params.staker, event.block)
  // A staker becomes current when their TOTAL across all validators crosses zero, not when a
  // single position does. Otherwise someone unstaking from one of two validators would leave
  // the count while still staking.
  const wasStaking = st.totalStaked.gt(ZERO)

  const s = new Stake(event.transaction.hash.toHexString() + "-" + event.logIndex.toString())
  s.staker = event.params.staker
  s.validator = v.id
  s.amount = event.params.amount
  s.blockNumber = event.block.number
  s.timestamp = event.block.timestamp
  s.transactionHash = event.transaction.hash
  s.save()

  // The delegation row is never deleted, only zeroed. See the schema for why.
  const did = stakerId + "-" + v.id
  let d = Delegation.load(did)
  if (d == null) {
    d = new Delegation(did)
    d.staker = event.params.staker
    d.stakerRef = st.id
    d.validator = v.id
    d.amount = ZERO
    d.firstStakedAtBlock = event.block.number
    d.firstStakedAtTimestamp = event.block.timestamp
    v.stakersEver = v.stakersEver + 1
    n.delegationsEver = n.delegationsEver + 1
  }
  // A position becomes current only when it crosses from zero. Incrementing on every stake
  // would count the same position again each time the staker tops up.
  if (d.amount.equals(ZERO)) {
    v.stakersCurrent = v.stakersCurrent + 1
    n.delegationsCurrent = n.delegationsCurrent + 1
    st.validatorCount = st.validatorCount + 1
  }
  d.amount = d.amount.plus(event.params.amount)
  d.lastActivityAtBlock = event.block.number
  d.save()

  st.totalStaked = st.totalStaked.plus(event.params.amount)
  st.save()

  v.totalStaked = v.totalStaked.plus(event.params.amount)
  v.save()

  n.totalStaked = n.totalStaked.plus(event.params.amount)
  n.stakeCount = n.stakeCount + 1
  if (isNewStaker) n.stakersEver = n.stakersEver + 1
  if (!wasStaking) n.stakersCurrent = n.stakersCurrent + 1
  n.save()

  const day = dayData(event.block, n)
  day.stakedIn = day.stakedIn.plus(event.params.amount)
  day.stakeCount = day.stakeCount + 1
  day.save()
}

/**
 * Unstaking. The amount leaves the validator's stake immediately and enters the queue; it
 * leaves the queue later, on WithdrawalClaimed.
 *
 * Two conservation identities hold here at once: stakes minus withdrawals equals totalStakedAmount(),
 * and initiated minus claimed equals totalPendingWithdrawals(). The differential test asserts
 * both against the chain.
 */
export function handleWithdrawalInitiated(event: WithdrawalInitiated): void {
  const n = network()
  const v = validator(event.params.validator, event.block)
  const st = staker(event.params.staker, event.block)

  const w = new Withdrawal(event.params.withdrawalId.toString())
  w.staker = event.params.staker
  w.validator = v.id
  w.amount = event.params.amount
  w.claimed = false
  w.initiatedAtBlock = event.block.number
  w.initiatedAtTimestamp = event.block.timestamp
  w.initiatedTxHash = event.transaction.hash
  w.save()

  const did = event.params.staker.toHexString() + "-" + v.id
  const d = Delegation.load(did)
  if (d == null) {
    // Impossible: a withdrawal requires a prior stake, which creates the row. If it happens,
    // the numbers below are already wrong, so stop rather than serve them.
    log.critical("withdrawal {} from an unknown delegation {}", [w.id, did])
    return
  }
  d.amount = d.amount.minus(event.params.amount)
  d.lastActivityAtBlock = event.block.number
  d.save()

  if (d.amount.equals(ZERO)) {
    v.stakersCurrent = v.stakersCurrent - 1
    n.delegationsCurrent = n.delegationsCurrent - 1
    st.validatorCount = st.validatorCount - 1
  }

  st.totalStaked = st.totalStaked.minus(event.params.amount)
  st.save()
  // Only when the address holds nothing anywhere does it stop being a current staker.
  if (st.totalStaked.equals(ZERO)) n.stakersCurrent = n.stakersCurrent - 1

  v.totalStaked = v.totalStaked.minus(event.params.amount)
  v.save()

  n.totalStaked = n.totalStaked.minus(event.params.amount)
  n.pendingWithdrawals = n.pendingWithdrawals.plus(event.params.amount)
  n.withdrawalCount = n.withdrawalCount + 1
  n.save()

  const day = dayData(event.block, n)
  day.withdrawnOut = day.withdrawnOut.plus(event.params.amount)
  day.withdrawalCount = day.withdrawalCount + 1
  day.save()
}

/**
 * The cooldown finished and the staker took the tokens.
 *
 * The event carries no validator, only the withdrawalId. That is why Withdrawal is keyed by
 * withdrawalId: this handler needs the row written by handleWithdrawalInitiated to know which
 * validator it belonged to.
 */
export function handleWithdrawalClaimed(event: WithdrawalClaimed): void {
  const id = event.params.withdrawalId.toString()
  const w = Withdrawal.load(id)
  if (w == null) {
    // Impossible unless the subgraph started after the matching initiation. The manifest
    // starts at the verified deploy block, so it cannot.
    log.critical("claimed withdrawal {} was never initiated", [id])
    return
  }

  w.claimed = true
  w.claimedAtBlock = event.block.number
  w.claimedAtTimestamp = event.block.timestamp
  w.claimedTxHash = event.transaction.hash
  w.save()

  const n = network()
  n.pendingWithdrawals = n.pendingWithdrawals.minus(w.amount)
  n.save()
}

/** Registration and deregistration. No deregistration has occurred on Mainnet to date. */
export function handleValidatorUpdated(event: ValidatorUpdated): void {
  const n = network()
  const v = validator(event.params.validator, event.block)

  const was = v.isRegistered
  v.isRegistered = event.params.isRegistered
  v.save()

  if (was != event.params.isRegistered) {
    n.activeValidators = n.activeValidators + (event.params.isRegistered ? 1 : -1)
    n.save()
  }
}
