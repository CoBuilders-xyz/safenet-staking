import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import { handleSignShared, handleSignCompleted } from "../src/frostcoordinator"
import { handleTransactionProposed, handleTransactionAttested, handleEpochRolledOver } from "../src/consensus"
import { signShared, signCompleted, transactionProposed, transactionAttested, epochRolledOver } from "./events"

const SID = "0x" + "aa".repeat(32)
const SID2 = "0x" + "bb".repeat(32)
const WIN = "0x" + "11".repeat(32)
const LOSE = "0x" + "22".repeat(32)
const TXH = "0x" + "cc".repeat(32)
const SAFE = "0x3333333333333333333333333333333333333333"

const V1 = "0xa111111111111111111111111111111111111111"
const V2 = "0xa222222222222222222222222222222222222222"
const V3 = "0xa333333333333333333333333333333333333333"

const DAY1 = 1775088000

describe("participation", () => {
  afterEach(() => { clearStore() })

  test("shares are counted only when the ceremony is an attestation", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 1))

    // Completed, but nothing said it was an attestation. It must not count yet.
    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "0")
    assert.entityCount("Ceremony", 1)

    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 2))

    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "1")
    assert.fieldEquals("SigningValidator", V1, "attended", "1")
  })

  test("the order of SignCompleted and TransactionAttested does not matter", () => {
    // Measured on 2026-09-29: both sit in the SAME block, so log order decides which handler
    // runs first. Neither order may be assumed.
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 1))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 2))

    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "1")
    assert.fieldEquals("SigningValidator", V1, "attended", "1")
  })

  test("a share for a losing root does not count", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignShared(signShared(SID, LOSE, V2, 1, DAY1, 1))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 2))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 3))

    assert.fieldEquals("SigningValidator", V1, "attended", "1")
    // V2 shared, but for the root that lost. The oracle does not count it, nor do we.
    assert.fieldEquals("SigningValidator", V2, "attended", "0")
  })

  test("a validator sharing twice for one root is counted once", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 1))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 2))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 3))

    assert.fieldEquals("SigningValidator", V1, "attended", "1")
  })

  test("absences are the difference, not a stored counter", () => {
    // Two ceremonies. V1 attends both, V2 attends one, V3 attends none.
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignShared(signShared(SID, WIN, V2, 1, DAY1, 1))
    handleSignShared(signShared(SID, WIN, V3, 1, DAY1, 2))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 3))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 4))

    handleSignShared(signShared(SID2, WIN, V1, 2, DAY1, 0))
    handleSignCompleted(signCompleted(SID2, WIN, 2, DAY1, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID2, 2, DAY1, 2))

    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "2")
    assert.fieldEquals("SigningValidator", V1, "attended", "2")   // absent = 2 - 2 = 0
    assert.fieldEquals("SigningValidator", V2, "attended", "1")   // absent = 2 - 1 = 1
    assert.fieldEquals("SigningValidator", V3, "attended", "1")   // absent = 2 - 1 = 1
  })

  test("a counted ceremony and its tallies are removed", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignShared(signShared(SID, LOSE, V2, 1, DAY1, 1))
    assert.entityCount("RootTally", 2)

    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 2))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 3))

    // Both tallies go, winner and loser. Otherwise these tables grow forever.
    assert.entityCount("Ceremony", 0)
    assert.entityCount("RootTally", 0)
    assert.fieldEquals("Consensus", "1", "openCeremonies", "0")
  })

  test("latency is bucketed by block distance", () => {
    handleTransactionProposed(transactionProposed(TXH, 1, SAFE, 100, DAY1, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 105, DAY1, 0))

    assert.fieldEquals("ConsensusDay", DAY1.toString(), "latencySamples", "1")
    assert.entityCount("PendingProposal", 0)   // removed once measured
  })

  test("latency beyond the oracle's limit is excluded, not counted", () => {
    handleTransactionProposed(transactionProposed(TXH, 1, SAFE, 100, DAY1, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 200, DAY1, 0))

    // 100 blocks is past MAX_EXPECTED_LATENCY of 64. The oracle drops it, so we drop it.
    assert.fieldEquals("ConsensusDay", DAY1.toString(), "latencySamples", "0")
    assert.fieldEquals("ConsensusDay", DAY1.toString(), "latencyOverflow", "1")
  })

  test("a ceremony that completes without an attestation is counted as such", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 1))

    // 24 of 9,418 ceremonies in two days end here. The oracle excludes them from
    // participation, and the field must say so rather than report zero forever.
    assert.fieldEquals("Consensus", "1", "nonAttestationCeremonies", "1")
    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "0")
  })

  test("a late attestation reverses the write-off instead of double counting", () => {
    // Both events sit in the SAME block, so SignCompleted may simply run first. When the
    // attestation follows, the ceremony must move from one bucket to the other, not be
    // counted in both.
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 1))
    assert.fieldEquals("Consensus", "1", "nonAttestationCeremonies", "1")

    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 2))

    assert.fieldEquals("Consensus", "1", "nonAttestationCeremonies", "0")
    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "1")
    assert.fieldEquals("SigningValidator", V1, "attended", "1")
  })

  test("epoch rollovers are recorded", () => {
    handleEpochRolledOver(epochRolledOver(42, 1, DAY1, 0))
    assert.fieldEquals("Consensus", "1", "currentEpoch", "42")
    assert.fieldEquals("Consensus", "1", "epochRollovers", "1")
  })
})
