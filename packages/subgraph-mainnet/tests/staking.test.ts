import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import {
  handleStakeIncreased,
  handleWithdrawalInitiated,
  handleWithdrawalClaimed,
  handleValidatorUpdated,
} from "../src/staking"
import { stakeIncreased, withdrawalInitiated, withdrawalClaimed, validatorUpdated } from "./events"

const ALICE = "0x1111111111111111111111111111111111111111"
const BOB = "0x2222222222222222222222222222222222222222"
const VAL_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const VAL_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// 2026-04-02T00:00:00Z and one day later, to exercise the daily buckets.
const DAY1 = 1775088000
const DAY2 = DAY1 + 86400

describe("staking", () => {
  afterEach(() => { clearStore() })

  test("a stake records the event and the running totals", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1))

    assert.entityCount("Stake", 1)
    assert.fieldEquals("Validator", VAL_A, "totalStaked", "100")
    assert.fieldEquals("Network", "1", "totalStaked", "100")
    assert.fieldEquals("Network", "1", "stakeCount", "1")
  })

  test("a repeat stake adds value but not a delegator", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "50", 2, DAY1, 1))

    assert.fieldEquals("Validator", VAL_A, "totalStaked", "150")
    // The bug this guards: incrementing on every stake would say 2.
    assert.fieldEquals("Validator", VAL_A, "stakersCurrent", "1")
    assert.fieldEquals("Validator", VAL_A, "stakersEver", "1")
    assert.fieldEquals("Network", "1", "stakersCurrent", "1")
    assert.entityCount("Delegation", 1)
  })

  test("the same staker on two validators is two delegations", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(ALICE, VAL_B, "100", 1, DAY1, 1))

    assert.entityCount("Delegation", 2)
    // The differential test caught a handler that counted this as 2. One address is one staker,
    // whatever number of validators it spreads across.
    assert.fieldEquals("Network", "1", "stakersCurrent", "1")
    assert.fieldEquals("Network", "1", "delegationsCurrent", "2")
    assert.entityCount("Staker", 1)
    assert.fieldEquals("Validator", VAL_A, "stakersCurrent", "1")
    assert.fieldEquals("Validator", VAL_B, "stakersCurrent", "1")
  })

  test("leaving one validator while staking on another keeps the staker current", () => {
    // This is the shape that produced the wrong number. ALICE holds two positions. Closing
    // one must not remove her from the network count, because she is still staking.
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(ALICE, VAL_B, "100", 1, DAY1, 1))
    assert.fieldEquals("Network", "1", "stakersCurrent", "1")
    assert.fieldEquals("Network", "1", "delegationsCurrent", "2")

    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 1, "100", 2, DAY1, 2))

    assert.fieldEquals("Network", "1", "stakersCurrent", "1")   // still staking on VAL_B
    assert.fieldEquals("Network", "1", "delegationsCurrent", "1")
    assert.fieldEquals("Staker", ALICE, "totalStaked", "100")
    assert.fieldEquals("Staker", ALICE, "validatorCount", "1")
  })

  test("leaving every validator removes the staker from the count", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(ALICE, VAL_B, "100", 1, DAY1, 1))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 1, "100", 2, DAY1, 2))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_B, 2, "100", 2, DAY1, 3))

    assert.fieldEquals("Network", "1", "stakersCurrent", "0")
    assert.fieldEquals("Network", "1", "stakersEver", "1")      // the row survives
    assert.fieldEquals("Staker", ALICE, "totalStaked", "0")
    assert.fieldEquals("Staker", ALICE, "validatorCount", "0")
  })

  test("two addresses on the same validator are two stakers", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(BOB, VAL_A, "100", 1, DAY1, 1))

    assert.fieldEquals("Network", "1", "stakersCurrent", "2")
    assert.fieldEquals("Validator", VAL_A, "stakersCurrent", "2")
    assert.entityCount("Staker", 2)
  })

  test("a full withdrawal zeroes the delegation but keeps the row", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 1, "100", 2, DAY1, 1))

    // The row survives, so "ever staked" stays answerable without a reindex.
    assert.entityCount("Delegation", 1)
    assert.fieldEquals("Delegation", ALICE + "-" + VAL_A, "amount", "0")
    assert.fieldEquals("Validator", VAL_A, "stakersCurrent", "0")
    assert.fieldEquals("Validator", VAL_A, "stakersEver", "1")
    assert.fieldEquals("Validator", VAL_A, "totalStaked", "0")
  })

  test("staking again after a full exit does not double count ever", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 1, "100", 2, DAY1, 1))
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "70", 3, DAY1, 2))

    assert.fieldEquals("Validator", VAL_A, "stakersEver", "1")
    assert.fieldEquals("Validator", VAL_A, "stakersCurrent", "1")
    assert.fieldEquals("Validator", VAL_A, "totalStaked", "70")
  })

  test("stakes minus withdrawals equals totalStaked", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(BOB, VAL_A, "300", 1, DAY1, 1))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 1, "40", 2, DAY1, 2))

    assert.fieldEquals("Network", "1", "totalStaked", "360")
  })

  test("initiated minus claimed equals pendingWithdrawals", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_A, 7, "60", 2, DAY1, 1))
    assert.fieldEquals("Network", "1", "pendingWithdrawals", "60")

    handleWithdrawalClaimed(withdrawalClaimed(ALICE, 7, "60", 3, DAY2, 0))
    assert.fieldEquals("Network", "1", "pendingWithdrawals", "0")
    assert.fieldEquals("Withdrawal", "7", "claimed", "true")
  })

  test("a claim finds its validator through the withdrawalId", () => {
    // WithdrawalClaimed carries no validator. The join is the reason for the entity key.
    handleStakeIncreased(stakeIncreased(ALICE, VAL_B, "100", 1, DAY1, 0))
    handleWithdrawalInitiated(withdrawalInitiated(ALICE, VAL_B, 42, "100", 2, DAY1, 1))
    handleWithdrawalClaimed(withdrawalClaimed(ALICE, 42, "100", 3, DAY2, 0))

    assert.fieldEquals("Withdrawal", "42", "validator", VAL_B)
  })

  test("registration counts a validator once, not per event", () => {
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 1, DAY1, 0))
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 2, DAY1, 1))

    assert.fieldEquals("Network", "1", "activeValidators", "1")
    assert.fieldEquals("Validator", VAL_A, "isRegistered", "true")
  })

  test("registeredAtBlock is the registration, not the first stake", () => {
    // A stake can reach a validator before its ValidatorUpdated is indexed. The row exists from
    // the stake, but it registered at block 5.
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 5, DAY2, 0))

    assert.fieldEquals("Validator", VAL_A, "registeredAtBlock", "5")
    assert.fieldEquals("Validator", VAL_A, "registeredAtTimestamp", DAY2.toString())
    assert.fieldEquals("Validator", VAL_A, "firstSeenAtBlock", "1")
    assert.fieldEquals("Validator", VAL_A, "firstSeenAtTimestamp", DAY1.toString())
  })

  test("a validator seen only through stakes has no registration block", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))

    assert.fieldEquals("Validator", VAL_A, "registeredAtBlock", "null")
    assert.fieldEquals("Validator", VAL_A, "firstSeenAtBlock", "1")
  })

  test("a repeated registration keeps the block that registered it", () => {
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 1, DAY1, 0))
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 2, DAY1, 1))

    assert.fieldEquals("Validator", VAL_A, "registeredAtBlock", "1")
  })

  test("a registration after a deregistration moves the registration block", () => {
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 1, DAY1, 0))
    handleValidatorUpdated(validatorUpdated(VAL_A, false, 2, DAY1, 0))
    // Deregistered, the row keeps the block it last registered at.
    assert.fieldEquals("Validator", VAL_A, "registeredAtBlock", "1")
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 3, DAY2, 0))

    assert.fieldEquals("Validator", VAL_A, "registeredAtBlock", "3")
    assert.fieldEquals("Validator", VAL_A, "firstSeenAtBlock", "1")
  })

  test("deregistration lowers the active count", () => {
    handleValidatorUpdated(validatorUpdated(VAL_A, true, 1, DAY1, 0))
    handleValidatorUpdated(validatorUpdated(VAL_A, false, 2, DAY2, 0))

    assert.fieldEquals("Network", "1", "activeValidators", "0")
    assert.fieldEquals("Validator", VAL_A, "isRegistered", "false")
  })

  test("daily buckets split by UTC day and carry the total", () => {
    handleStakeIncreased(stakeIncreased(ALICE, VAL_A, "100", 1, DAY1, 0))
    handleStakeIncreased(stakeIncreased(BOB, VAL_A, "50", 2, DAY2, 0))

    assert.entityCount("DayData", 2)
    assert.fieldEquals("DayData", DAY1.toString(), "stakedIn", "100")
    assert.fieldEquals("DayData", DAY1.toString(), "totalStaked", "100")
    assert.fieldEquals("DayData", DAY2.toString(), "stakedIn", "50")
    assert.fieldEquals("DayData", DAY2.toString(), "totalStaked", "150")
  })
})
