import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import { handleClaimed, handleMerkelRootUpdated } from "../src/merkledrop"
import { claimed, merkelRootUpdated } from "./events"

const ALICE = "0x1111111111111111111111111111111111111111"
const BOB = "0x2222222222222222222222222222222222222222"
const DAY1 = 1775088000

describe("merkle drop", () => {
  afterEach(() => { clearStore() })

  test("a first claim pays the whole cumulative amount", () => {
    handleClaimed(claimed(ALICE, "500", 1, DAY1))

    assert.fieldEquals("Network", "1", "rewardsClaimed", "500")
    assert.fieldEquals("RewardAccount", ALICE, "cumulativeClaimed", "500")
  })

  test("a second claim pays only the difference", () => {
    // The event carries the account's CUMULATIVE total, not this payment. Summing the field
    // would report 1,300 paid when the contract paid 800. This is the bug the test guards.
    handleClaimed(claimed(ALICE, "500", 1, DAY1, 0))
    handleClaimed(claimed(ALICE, "800", 2, DAY1, 1))

    assert.fieldEquals("Network", "1", "rewardsClaimed", "800")
    assert.fieldEquals("RewardAccount", ALICE, "cumulativeClaimed", "800")
    assert.fieldEquals("RewardAccount", ALICE, "claimCount", "2")
    assert.entityCount("RewardClaim", 2)
  })

  test("each claim records what it alone paid", () => {
    handleClaimed(claimed(ALICE, "500", 1, DAY1, 0))
    handleClaimed(claimed(ALICE, "800", 2, DAY1, 1))

    assert.fieldEquals("RewardClaim", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-0", "amount", "500")
    assert.fieldEquals("RewardClaim", "0xa16081f360e3847006db660bae1c6d1b2e17ec2a-1", "amount", "300")
  })

  test("root updates number the periods from one", () => {
    const ZERO_ROOT = "0x" + "00".repeat(32)
    const R1 = "0x" + "11".repeat(32)
    const R2 = "0x" + "22".repeat(32)

    handleMerkelRootUpdated(merkelRootUpdated(ZERO_ROOT, R1, 1, DAY1, 0))
    handleMerkelRootUpdated(merkelRootUpdated(R1, R2, 2, DAY1, 1))

    assert.entityCount("RewardPeriod", 2)
    assert.fieldEquals("RewardPeriod", "1", "root", R1)
    assert.fieldEquals("RewardPeriod", "2", "previousRoot", R1)
    assert.fieldEquals("RewardPeriod", "2", "root", R2)
    assert.fieldEquals("Network", "1", "rewardPeriods", "2")
    assert.fieldEquals("Network", "1", "currentRoot", R2)
  })

  test("a period records what had been claimed before it started", () => {
    const R1 = "0x" + "11".repeat(32)
    const R2 = "0x" + "22".repeat(32)

    handleMerkelRootUpdated(merkelRootUpdated("0x" + "00".repeat(32), R1, 1, DAY1, 0))
    handleClaimed(claimed(ALICE, "500", 2, DAY1, 0))
    handleMerkelRootUpdated(merkelRootUpdated(R1, R2, 3, DAY1, 1))

    // Period 1 started with nothing claimed. Period 2 started after Alice took 500, so the
    // difference is what stakers actually took while root 1 was in force.
    assert.fieldEquals("RewardPeriod", "1", "cumulativeClaimedAtStart", "0")
    assert.fieldEquals("RewardPeriod", "2", "cumulativeClaimedAtStart", "500")
  })

  test("two accounts are independent", () => {
    handleClaimed(claimed(ALICE, "500", 1, DAY1, 0))
    handleClaimed(claimed(BOB, "200", 1, DAY1, 1))

    assert.fieldEquals("Network", "1", "rewardsClaimed", "700")
    assert.fieldEquals("RewardAccount", ALICE, "cumulativeClaimed", "500")
    assert.fieldEquals("RewardAccount", BOB, "cumulativeClaimed", "200")
  })
})
