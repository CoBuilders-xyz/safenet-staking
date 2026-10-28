import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import * as beta from "../src/frostcoordinator"
import * as betaConsensus from "../src/consensus"
import * as aegis from "../src/aegisfrostcoordinator"
import * as aegisConsensus from "../src/aegisconsensus"
import {
  signShared, signCompleted, transactionAttested,
  aegisSignShared, aegisSignCompleted, aegisKeyGenConfirmed, aegisValidatorStakerSet,
  aegisTransactionProposed, aegisTransactionAttested,
} from "./events"

const SID = "0x" + "aa".repeat(32)
const SID2 = "0x" + "bb".repeat(32)
const WIN = "0x" + "11".repeat(32)
const GID = "0x" + "99".repeat(32)
const TXH = "0x" + "cc".repeat(32)
const TXH2 = "0x" + "dd".repeat(32)
const SAFE = "0x3333333333333333333333333333333333333333"
// A safeId packs the chain id over the Safe's address: chain 1, then SAFE.
const SAFE_ID = "0x0000000000000000000000013333333333333333333333333333333333333333"
const ORACLE = "0x4444444444444444444444444444444444444444"
const OTHER_ORACLE = "0x5555555555555555555555555555555555555555"
const STAKER = "0x6666666666666666666666666666666666666666"

const V1 = "0xa111111111111111111111111111111111111111"
const V2 = "0xa222222222222222222222222222222222222222"
const V3 = "0xa333333333333333333333333333333333333333"

// 2026-10-20T00:00:00Z, a UTC midnight, and an hour into it.
const DAY = 1792454400
const H = DAY + 3600

/** One complete Aegis attestation ceremony, all in one block, as the chain emits it. */
function aegisCeremony(sid: string, signers: string[], block: i32, ts: i32): void {
  for (let i = 0; i < signers.length; i++) aegis.handleSignShared(aegisSignShared(sid, WIN, signers[i], block, ts, i))
  aegis.handleSignCompleted(aegisSignCompleted(sid, WIN, block, ts, 10))
  aegisConsensus.handleTransactionAttested(aegisTransactionAttested(TXH, SAFE_ID, ORACLE, sid, block, ts, 11))
}

/** One complete Beta attestation ceremony. */
function betaCeremony(sid: string, signers: string[], block: i32, ts: i32): void {
  for (let i = 0; i < signers.length; i++) beta.handleSignShared(signShared(sid, WIN, signers[i], block, ts, i))
  beta.handleSignCompleted(signCompleted(sid, WIN, block, ts, 10))
  betaConsensus.handleTransactionAttested(transactionAttested(TXH, 1, SAFE, sid, block, ts, 11))
}

describe("aegis", () => {
  afterEach(() => { clearStore() })

  test("an Aegis ceremony is counted and filed under the Aegis programme", () => {
    aegisCeremony(SID, [V1], 100, H)

    assert.fieldEquals("Consensus", "aegis", "programme", "aegis")
    assert.fieldEquals("Consensus", "aegis", "attestationCeremonies", "1")
    assert.notInStore("Consensus", "beta")
    assert.fieldEquals("ConsensusHour", "aegis-" + H.toString(), "programme", "aegis")
    assert.fieldEquals("ConsensusHour", "aegis-" + H.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusDay", "aegis-" + DAY.toString(), "programme", "aegis")
    assert.fieldEquals("ConsensusDay", "aegis-" + DAY.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ValidatorDay", "aegis-" + V1 + "-" + DAY.toString(), "programme", "aegis")
    assert.fieldEquals("ValidatorDay", "aegis-" + V1 + "-" + DAY.toString(), "attended", "1")
    assert.fieldEquals("ValidatorHour", "aegis-" + V1 + "-" + H.toString(), "attended", "1")
    assert.entityCount("Ceremony", 0)
    assert.entityCount("RootTally", 0)
  })

  test("each programme misses only its own validators", () => {
    // V2 signs only on Beta and V3 only on Aegis. Neither may be given a miss on the other.
    betaCeremony(SID, [V1, V2], 100, H)
    aegisCeremony(SID2, [V1], 101, H + 5)
    aegis.handleKeyGenConfirmed(aegisKeyGenConfirmed(GID, V3, 101, H + 5, 0))
    aegisCeremony("0x" + "ee".repeat(32), [V1], 102, H + 10)

    assert.fieldEquals("Consensus", "beta", "validatorCount", "2")
    assert.fieldEquals("Consensus", "aegis", "validatorCount", "2")
    assert.fieldEquals("ConsensusHour", "beta-" + H.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusHour", "aegis-" + H.toString(), "attestationCeremonies", "2")

    assert.fieldEquals("ValidatorHour", "beta-" + V2 + "-" + H.toString(), "attended", "1")
    assert.notInStore("ValidatorHour", "aegis-" + V2 + "-" + H.toString())
    assert.notInStore("ValidatorHour", "beta-" + V3 + "-" + H.toString())
    // V3 joined Aegis by its key generation, after the first Aegis ceremony: one miss, not two.
    assert.fieldEquals("ValidatorHour", "aegis-" + V3 + "-" + H.toString(), "ceremonies", "1")
    assert.fieldEquals("ValidatorHour", "aegis-" + V3 + "-" + H.toString(), "missed", "1")
    assert.fieldEquals("ValidatorHour", "aegis-" + V1 + "-" + H.toString(), "attended", "2")
  })

  test("a Beta validator seen on Aegis is one row, listed by both programmes", () => {
    betaCeremony(SID, [V1], 100, H)
    aegisCeremony(SID2, [V1], 101, H + 5)

    assert.entityCount("SigningValidator", 1)
    assert.fieldEquals("SigningValidator", V1, "attended", "2")
    assert.fieldEquals("SigningValidator", V1, "firstSeenBlock", "100")
    assert.fieldEquals("Consensus", "beta", "validators", "[" + V1 + "]")
    assert.fieldEquals("Consensus", "aegis", "validators", "[" + V1 + "]")
  })

  test("the same sid on both coordinators is two ceremonies", () => {
    // A sid is unique on one coordinator only. An Aegis share must not land in a Beta ceremony.
    beta.handleSignShared(signShared(SID, WIN, V1, 100, H, 0))
    aegis.handleSignShared(aegisSignShared(SID, WIN, V2, 100, H, 1))
    assert.entityCount("Ceremony", 2)

    aegis.handleSignCompleted(aegisSignCompleted(SID, WIN, 100, H, 2))
    aegisConsensus.handleTransactionAttested(aegisTransactionAttested(TXH, SAFE_ID, ORACLE, SID, 100, H, 3))

    assert.fieldEquals("ValidatorHour", "aegis-" + V2 + "-" + H.toString(), "attended", "1")
    assert.notInStore("ValidatorHour", "aegis-" + V1 + "-" + H.toString())
    assert.fieldEquals("Ceremony", "beta-" + SID, "counted", "false")
    assert.notInStore("Ceremony", "aegis-" + SID)
    assert.fieldEquals("CountedCeremony", "aegis-" + SID, "countedAtBlock", "100")
  })

  test("an Aegis attestation is timed against the proposal of the same Safe and oracle", () => {
    aegisConsensus.handleTransactionProposed(aegisTransactionProposed(TXH, SAFE_ID, ORACLE, 100, H, 0))
    // The same safeTxHash under another oracle is another proposal, and is not matched.
    aegisConsensus.handleTransactionProposed(aegisTransactionProposed(TXH2, SAFE_ID, OTHER_ORACLE, 100, H, 1))
    aegisConsensus.handleTransactionAttested(aegisTransactionAttested(TXH, SAFE_ID, ORACLE, SID, 103, H + 15, 0))
    aegisConsensus.handleTransactionAttested(aegisTransactionAttested(TXH2, SAFE_ID, ORACLE, SID2, 103, H + 15, 1))

    assert.fieldEquals("Consensus", "aegis", "proposals", "2")
    assert.fieldEquals("Consensus", "aegis", "attestations", "2")
    assert.fieldEquals("Consensus", "aegis", "latencySamples", "1")
    assert.fieldEquals("ConsensusDay", "aegis-" + DAY.toString(), "latencySamples", "1")
    assert.entityCount("PendingProposal", 1)
    assert.notInStore("PendingProposal", "aegis-" + TXH + "-" + SAFE_ID + "-" + ORACLE)
  })

  test("a ceremony the coordinator completes without an Aegis attestation is not counted", () => {
    // Aegis's coordinator signs ceremonies that no TransactionAttested names, such as those
    // before its consensus contract existed.
    aegis.handleSignShared(aegisSignShared(SID, WIN, V1, 100, H, 0))
    aegis.handleSignCompleted(aegisSignCompleted(SID, WIN, 100, H, 1))

    assert.fieldEquals("Consensus", "aegis", "attestationCeremonies", "0")
    assert.fieldEquals("Consensus", "aegis", "nonAttestationCeremonies", "1")
    assert.entityCount("ConsensusHour", 0)
  })

  test("ValidatorStakerSet on Aegis lists the validator and records its staker", () => {
    aegisConsensus.handleValidatorStakerSet(aegisValidatorStakerSet(V1, STAKER, 100, H))

    assert.fieldEquals("SigningValidator", V1, "staker", STAKER)
    assert.fieldEquals("Consensus", "aegis", "validatorCount", "1")
    assert.notInStore("Consensus", "beta")
  })
})
