import { assert, describe, test, clearStore, afterEach } from "matchstick-as/assembly/index"
import { ConsensusHour, ValidatorHour } from "../generated/schema"
import { handleSignShared, handleSignCompleted } from "../src/frostcoordinator"
import { handleTransactionAttested } from "../src/consensus"
import { signShared, signCompleted, transactionAttested } from "./events"

const SID = "0x" + "aa".repeat(32)
const SID2 = "0x" + "bb".repeat(32)
const SID3 = "0x" + "dd".repeat(32)
const SID4 = "0x" + "ee".repeat(32)
const WIN = "0x" + "11".repeat(32)
const LOSE = "0x" + "22".repeat(32)
const TXH = "0x" + "cc".repeat(32)
const SAFE = "0x3333333333333333333333333333333333333333"

const V1 = "0xa111111111111111111111111111111111111111"
const V2 = "0xa222222222222222222222222222222222222222"
const V3 = "0xa333333333333333333333333333333333333333"

// 2026-04-02T00:00:00Z, a UTC midnight, then three hours later. Gnosis slots are 5 seconds, so
// a block can sit exactly on the hour; the blocks around it are 5 seconds either side.
const DAY1 = 1775088000
const H = DAY1 + 3 * 3600

function hourId(v: string, hour: i32): string {
  return v + "-" + hour.toString()
}

/** One complete attestation ceremony: shares, completion and attestation in one block. */
function ceremonyAt(sid: string, signers: string[], block: i32, ts: i32): void {
  for (let i = 0; i < signers.length; i++) handleSignShared(signShared(sid, WIN, signers[i], block, ts, i))
  handleSignCompleted(signCompleted(sid, WIN, block, ts, signers.length))
  handleTransactionAttested(transactionAttested(TXH, 1, SAFE, sid, block, ts, signers.length + 1))
}

describe("hourly buckets", () => {
  afterEach(() => { clearStore() })

  test("a ceremony attested in the block exactly on the hour is filed under that hour, and marked", () => {
    // One block before the hour, one exactly on it. SEF's window ends on the hour and includes
    // that block, so the bucket must say which of its ceremonies sit in it.
    ceremonyAt(SID, [V1], 10, H - 5)
    ceremonyAt(SID2, [V1], 11, H)

    const before = (H - 3600).toString()
    assert.fieldEquals("ConsensusHour", before, "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusHour", before, "attestationCeremoniesOnTheHour", "0")
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremoniesOnTheHour", "1")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "attended", "1")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "attendedOnTheHour", "1")
    assert.fieldEquals("ValidatorHour", hourId(V1, H - 3600), "attendedOnTheHour", "0")
  })

  test("shares in one hour and the attestation in the next are filed by the attestation", () => {
    handleSignShared(signShared(SID, WIN, V1, 10, H - 5, 0))
    handleSignCompleted(signCompleted(SID, WIN, 11, H + 5, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 11, H + 5, 1))

    assert.entityCount("ConsensusHour", 1)
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremoniesOnTheHour", "0")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "attended", "1")
  })

  test("the attestation block decides, also when SignCompleted sits in an earlier block", () => {
    // Completed one block before the hour, attested on the hour. The SignCompleted handler runs
    // first, so it is the attestation that counts the ceremony; the bucket is the attestation's.
    handleSignShared(signShared(SID, WIN, V1, 10, H - 5, 0))
    handleSignCompleted(signCompleted(SID, WIN, 10, H - 5, 1))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 11, H, 0))

    assert.entityCount("ConsensusHour", 1)
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremoniesOnTheHour", "1")
  })

  test("the attestation block decides, also when SignCompleted counts the ceremony later", () => {
    // The other handler order: the attestation is indexed first, on the hour, and SignCompleted
    // arrives a block later and does the counting. The ceremony is still filed on the hour.
    handleSignShared(signShared(SID, WIN, V1, 10, H - 5, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 11, H, 0))
    handleSignCompleted(signCompleted(SID, WIN, 12, H + 5, 0))

    assert.entityCount("ConsensusHour", 1)
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremoniesOnTheHour", "1")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "attendedOnTheHour", "1")
  })

  test("a known validator that does not share for the winning root is a miss", () => {
    // First ceremony: all three share, so all three are known.
    ceremonyAt(SID, [V1, V2, V3], 10, H + 5)
    // Second: V1 shares for the winner, V2 for a losing root, V3 not at all.
    handleSignShared(signShared(SID2, WIN, V1, 11, H + 10, 0))
    handleSignShared(signShared(SID2, LOSE, V2, 11, H + 10, 1))
    handleSignCompleted(signCompleted(SID2, WIN, 11, H + 10, 2))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID2, 11, H + 10, 3))

    assert.fieldEquals("ConsensusHour", H.toString(), "attestationCeremonies", "2")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "ceremonies", "2")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "attended", "2")
    assert.fieldEquals("ValidatorHour", hourId(V1, H), "missed", "0")
    assert.fieldEquals("ValidatorHour", hourId(V2, H), "ceremonies", "2")
    assert.fieldEquals("ValidatorHour", hourId(V2, H), "attended", "1")
    assert.fieldEquals("ValidatorHour", hourId(V2, H), "missed", "1")
    assert.fieldEquals("ValidatorHour", hourId(V3, H), "attended", "1")
    assert.fieldEquals("ValidatorHour", hourId(V3, H), "missed", "1")
  })

  test("a ceremony that is not an attestation fills no bucket", () => {
    handleSignShared(signShared(SID, WIN, V1, 10, H + 5, 0))
    handleSignCompleted(signCompleted(SID, WIN, 10, H + 5, 1))

    assert.entityCount("ConsensusHour", 0)
    assert.entityCount("ValidatorHour", 0)
  })

  test("SEF's window, both ends included, is the hours before its end plus the end's own block", () => {
    // The window [H, H + 2h]. Inside: one ceremony in hour H, one in hour H + 1h, one in the
    // block exactly at H + 2h. Outside: one a block after the end, which shares that hour's row.
    const end = H + 2 * 3600
    ceremonyAt(SID, [V1, V2], 10, H)
    ceremonyAt(SID2, [V1], 11, H + 3600 + 5)
    ceremonyAt(SID3, [V1, V2], 12, end)
    ceremonyAt(SID4, [V2], 13, end + 5)

    let ceremonies = 0
    let v1 = 0
    let v2 = 0
    for (let hour = H; hour < end; hour += 3600) {
      const c = ConsensusHour.load(hour.toString())!
      ceremonies += c.attestationCeremonies
      v1 += ValidatorHour.load(hourId(V1, hour))!.attended
      v2 += ValidatorHour.load(hourId(V2, hour))!.attended
    }
    ceremonies += ConsensusHour.load(end.toString())!.attestationCeremoniesOnTheHour
    v1 += ValidatorHour.load(hourId(V1, end))!.attendedOnTheHour
    v2 += ValidatorHour.load(hourId(V2, end))!.attendedOnTheHour

    assert.i32Equals(3, ceremonies)
    assert.i32Equals(3, v1)
    assert.i32Equals(2, v2)
    // The end hour's row holds both of its ceremonies; only the one on the hour is in the window.
    assert.fieldEquals("ConsensusHour", end.toString(), "attestationCeremonies", "2")
  })

  test("daily buckets are filed by the attestation, not the first share", () => {
    // Shared five seconds before midnight, attested five seconds after.
    const midnight = DAY1 + 86400
    handleSignShared(signShared(SID, WIN, V1, 10, midnight - 5, 0))
    handleSignCompleted(signCompleted(SID, WIN, 11, midnight + 5, 0))
    handleTransactionAttested(transactionAttested(TXH, 1, SAFE, SID, 11, midnight + 5, 1))

    assert.fieldEquals("ConsensusDay", midnight.toString(), "attestationCeremonies", "1")
    assert.fieldEquals("ValidatorDay", V1 + "-" + midnight.toString(), "attended", "1")
    assert.notInStore("ValidatorDay", V1 + "-" + DAY1.toString())
  })
})
