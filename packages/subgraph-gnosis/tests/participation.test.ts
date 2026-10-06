import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import { handleSignShared, handleSignCompleted } from "../src/frostcoordinator"
import { handleTransactionProposed, handleTransactionAttested, handleEpochRolledOver } from "../src/consensus"
import { Address, BigInt } from "@graphprotocol/graph-ts"
import { COUNTED_HORIZON, consensus, signingValidator } from "../src/shared"
import { signShared, signCompleted, transactionProposed, transactionAttested, epochRolledOver } from "./events"

const SID = "0x" + "aa".repeat(32)
const SID2 = "0x" + "bb".repeat(32)
const SID3 = "0x" + "ee".repeat(32)
const WIN = "0x" + "11".repeat(32)
const LOSE = "0x" + "22".repeat(32)
const TXH = "0x" + "cc".repeat(32)
const TXH2 = "0x" + "dd".repeat(32)
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
    // Both have sat in the same transaction every time it was measured, SignCompleted first.
    // Nothing known enforces that order, so neither may be assumed.
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

  test("a share arriving after its ceremony was counted leaves no orphan", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 2))

    handleSignShared(signShared(SID, WIN, V2, 2, DAY1 + 5, 0))

    // Without a record of the count, this share would open a new ceremony that nothing ever
    // completes, and openCeremonies would stay at 1 forever.
    assert.entityCount("Ceremony", 0)
    assert.entityCount("RootTally", 0)
    assert.fieldEquals("Consensus", "1", "openCeremonies", "0")
    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "1")
    assert.fieldEquals("SigningValidator", V2, "attended", "0")
  })

  test("a second attestation of a counted ceremony leaves no orphan", () => {
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 1, DAY1, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 1, DAY1, 2))

    handleTransactionAttested(transactionAttested(TXH2, 1, SAFE, SID, 2, DAY1 + 5, 0))

    assert.entityCount("Ceremony", 0)
    assert.fieldEquals("Consensus", "1", "openCeremonies", "0")
    assert.fieldEquals("Consensus", "1", "attestationCeremonies", "1")
    assert.fieldEquals("SigningValidator", V1, "attended", "1")
    // The event itself is real, so the attestation count still moves.
    assert.fieldEquals("Consensus", "1", "attestations", "2")
  })

  test("a counted ceremony is remembered for COUNTED_HORIZON blocks, then forgotten", () => {
    handleSignShared(signShared(SID, WIN, V1, 2, DAY1, 0))
    handleSignCompleted(signCompleted(SID, WIN, 2, DAY1, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 2, DAY1, 2))

    // Exactly COUNTED_HORIZON blocks later SID is still kept, so the set holds both.
    handleSignShared(signShared(SID2, WIN, V1, 2 + COUNTED_HORIZON, DAY1 + 5000, 0))
    handleSignCompleted(signCompleted(SID2, WIN, 2 + COUNTED_HORIZON, DAY1 + 5000, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID2, 2 + COUNTED_HORIZON, DAY1 + 5000, 2))
    assert.entityCount("CountedCeremony", 2)
    assert.fieldEquals("Consensus", "1", "countedOldest", SID)
    assert.fieldEquals("CountedCeremony", SID, "next", SID2)

    // One block further, the next count drops SID from the front of the queue.
    handleSignShared(signShared(SID3, WIN, V1, 3 + COUNTED_HORIZON, DAY1 + 5005, 0))
    handleSignCompleted(signCompleted(SID3, WIN, 3 + COUNTED_HORIZON, DAY1 + 5005, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID3, 3 + COUNTED_HORIZON, DAY1 + 5005, 2))
    assert.entityCount("CountedCeremony", 2)
    assert.notInStore("CountedCeremony", SID)
    assert.fieldEquals("Consensus", "1", "countedOldest", SID2)
    assert.fieldEquals("Consensus", "1", "countedNewest", SID3)
  })

  test("signingValidator never moves lastSeenBlock backwards", () => {
    // Called directly: every handler passes its own block, so no handler sequence reaches the
    // guard with an older block. The guard is the contract of the helper, tested as such.
    const c = consensus()
    signingValidator(Address.fromString(V1), BigInt.fromI32(5), c).save()
    signingValidator(Address.fromString(V1), BigInt.fromI32(1), c).save()

    assert.fieldEquals("SigningValidator", V1, "lastSeenBlock", "5")
    assert.fieldEquals("SigningValidator", V1, "firstSeenBlock", "5")
  })

  test("counting an older ceremony does not move lastSeenBlock backwards", () => {
    // V1 shares for SID at block 1 and for SID2 at block 5. SID is counted at block 6, and its
    // first block is 1: the validator was still last seen at block 5.
    handleSignShared(signShared(SID, WIN, V1, 1, DAY1, 0))
    handleSignShared(signShared(SID2, WIN, V1, 5, DAY1 + 20, 0))
    handleSignCompleted(signCompleted(SID, WIN, 6, DAY1 + 25, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 6, DAY1 + 25, 1))

    assert.fieldEquals("SigningValidator", V1, "lastSeenBlock", "5")
    assert.fieldEquals("SigningValidator", V1, "firstSeenBlock", "1")
  })

  test("epoch rollovers are recorded", () => {
    handleEpochRolledOver(epochRolledOver(42, 1, DAY1, 0))
    assert.fieldEquals("Consensus", "1", "currentEpoch", "42")
    assert.fieldEquals("Consensus", "1", "epochRollovers", "1")
  })
})
