import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { Network, Validator, DayData, Staker } from "../generated/schema"

export const ZERO = BigInt.fromI32(0)
const DAY = 86400

/** The single network row. Created on first use. */
export function network(): Network {
  let n = Network.load("1")
  if (n == null) {
    n = new Network("1")
    n.totalStaked = ZERO
    n.pendingWithdrawals = ZERO
    n.rewardsClaimed = ZERO
    n.activeValidators = 0
    n.stakersCurrent = 0
    n.stakersEver = 0
    n.delegationsCurrent = 0
    n.delegationsEver = 0
    n.stakeCount = 0
    n.withdrawalCount = 0
    n.rewardPeriods = 0
  }
  return n as Network
}

/**
 * A validator row, created on first sight.
 *
 * A stake can reach a validator before we have seen a ValidatorUpdated event for it, because
 * the registry event is rare and the contract does not require one first. So this creates the
 * row rather than assuming it exists. isRegistered stays false and registeredAtBlock null until
 * the event says otherwise, and activeValidators counts only those the event confirmed.
 */
export function validator(addr: Bytes, block: ethereum.Block): Validator {
  const id = addr.toHexString()
  let v = Validator.load(id)
  if (v == null) {
    v = new Validator(id)
    v.address = addr
    v.isRegistered = false
    v.totalStaked = ZERO
    v.stakersCurrent = 0
    v.stakersEver = 0
    v.firstSeenAtBlock = block.number
    v.firstSeenAtTimestamp = block.timestamp
    v.registeredAtBlock = null
    v.registeredAtTimestamp = null
  }
  v.lastUpdatedAtBlock = block.number
  return v as Validator
}

/** A staker row, created on the first stake anywhere. Never deleted. */
export function staker(addr: Bytes, block: ethereum.Block): Staker {
  const id = addr.toHexString()
  let s = Staker.load(id)
  if (s == null) {
    s = new Staker(id)
    s.address = addr
    s.totalStaked = ZERO
    s.validatorCount = 0
    s.firstStakedAtBlock = block.number
    s.firstStakedAtTimestamp = block.timestamp
  }
  s.lastActivityAtBlock = block.number
  return s as Staker
}

/**
 * The bucket for this block's UTC day, carrying the running total forward.
 *
 * A day with no events gets no row. A consumer drawing a line carries the last value forward.
 * Writing an empty row per quiet day would cost more rows than the events themselves.
 */
export function dayData(block: ethereum.Block, n: Network): DayData {
  const day = (block.timestamp.toI32() / DAY) * DAY
  const id = day.toString()
  let d = DayData.load(id)
  if (d == null) {
    d = new DayData(id)
    d.date = day
    d.stakedIn = ZERO
    d.withdrawnOut = ZERO
    d.rewardsClaimed = ZERO
    d.stakeCount = 0
    d.withdrawalCount = 0
  }
  d.totalStaked = n.totalStaked
  return d as DayData
}
