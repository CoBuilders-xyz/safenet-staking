import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import { Consensus, SigningValidator, ValidatorDay, ConsensusDay, Ceremony, RootTally } from "../generated/schema"

export const ZERO = BigInt.fromI32(0)
export const ONE = BigInt.fromI32(1)
const DAY = 86400

/** The oracle's MAX_EXPECTED_LATENCY. Beyond it a sample is excluded, as the oracle excludes it. */
export const MAX_LATENCY = 64

export function consensus(): Consensus {
  let c = Consensus.load("1")
  if (c == null) {
    c = new Consensus("1")
    c.attestationCeremonies = ZERO
    c.nonAttestationCeremonies = ZERO
    c.attestations = ZERO
    c.proposals = ZERO
    c.latencySamples = ZERO
    c.epochRollovers = 0
    c.openCeremonies = 0
    c.validatorCount = 0
  }
  return c as Consensus
}

/** Takes block and timestamp as values, so it can be called from a handler or from a replay. */
export function signingValidator(addr: Bytes, block: BigInt, c: Consensus): SigningValidator {
  const id = addr.toHexString()
  let v = SigningValidator.load(id)
  if (v == null) {
    v = new SigningValidator(id)
    v.address = addr
    v.attended = ZERO
    v.firstSeenBlock = block
    c.validatorCount = c.validatorCount + 1
  }
  v.lastSeenBlock = block
  return v as SigningValidator
}

export function dayStart(ts: BigInt): i32 {
  return (ts.toI32() / DAY) * DAY
}

export function validatorDay(v: SigningValidator, ts: BigInt): ValidatorDay {
  const day = dayStart(ts)
  const id = v.id + "-" + day.toString()
  let d = ValidatorDay.load(id)
  if (d == null) {
    d = new ValidatorDay(id)
    d.validator = v.id
    d.date = day
    d.attended = ZERO
  }
  return d as ValidatorDay
}

export function consensusDay(ts: BigInt): ConsensusDay {
  const day = dayStart(ts)
  const id = day.toString()
  let d = ConsensusDay.load(id)
  if (d == null) {
    d = new ConsensusDay(id)
    d.date = day
    d.attestations = ZERO
    d.attestationCeremonies = ZERO
    d.latencyOverflow = ZERO
    d.latencySamples = ZERO
    const buckets = new Array<BigInt>(MAX_LATENCY + 1)
    for (let i = 0; i <= MAX_LATENCY; i++) buckets[i] = ZERO
    d.latencyBuckets = buckets
  }
  return d as ConsensusDay
}

export function ceremony(sid: Bytes, block: BigInt, ts: BigInt, c: Consensus): Ceremony {
  const id = sid.toHexString()
  let cer = Ceremony.load(id)
  if (cer == null) {
    cer = new Ceremony(id)
    cer.isAttestation = false
    cer.counted = false
    cer.countedAsNonAttestation = false
    cer.roots = []
    cer.firstSeenBlock = block
    cer.timestamp = ts
    c.openCeremonies = c.openCeremonies + 1
  }
  return cer as Ceremony
}

/**
 * Count a ceremony once both facts are known, then delete what it needed.
 *
 * Two events supply those facts and, measured on 2026-09-29, they sit in the SAME block, so
 * neither order can be assumed:
 *
 *   SignCompleted        the winning selectionRoot. Shares for a losing root do not count
 *                        and shares are emitted before completion.
 *   TransactionAttested  that the ceremony was a transaction attestation. About 1 in 400 is
 *                        not, and the oracle excludes those from participation.
 *
 * Whichever handler makes the pair complete calls this. It is idempotent.
 */
export function tryCount(cer: Ceremony, c: Consensus): void {
  if (cer.counted) return
  const root = cer.winningRoot
  if (root === null) return

  if (!cer.isAttestation) {
    // Completed without an attestation. Measured: 24 of 9,418 in two days, which is the
    // 1-in-400 the oracle excludes from participation.
    //
    // It is recorded now rather than left silent, and reversed below if an attestation does
    // arrive: the two events sit in the SAME block, so this handler may simply have run
    // first. Counting it here and correcting there is order-independent; waiting is not,
    // because a handler cannot know a block has ended.
    if (!cer.countedAsNonAttestation) {
      cer.countedAsNonAttestation = true
      cer.save()
      c.nonAttestationCeremonies = c.nonAttestationCeremonies.plus(ONE)
    }
    return
  }

  // An attestation arrived after we had written this off. Reverse that.
  if (cer.countedAsNonAttestation) {
    c.nonAttestationCeremonies = c.nonAttestationCeremonies.minus(ONE)
  }

  c.attestationCeremonies = c.attestationCeremonies.plus(ONE)

  const day = consensusDay(cer.timestamp)
  day.attestationCeremonies = day.attestationCeremonies.plus(ONE)
  day.save()

  const winner = RootTally.load(cer.id + "-" + root.toHexString())
  if (winner != null) {
    const present = winner.participants
    for (let i = 0; i < present.length; i++) {
      const v = signingValidator(present[i], cer.firstSeenBlock, c)
      v.attended = v.attended.plus(ONE)
      v.save()
      const vd = validatorDay(v, cer.timestamp)
      vd.attended = vd.attended.plus(ONE)
      vd.save()
    }
  }

  c.openCeremonies = c.openCeremonies - 1
  remove(cer)
}

/**
 * Delete a ceremony and every tally it held.
 *
 * Without this the transient tables grow by about 4,600 ceremonies a day forever, which is
 * the cost the Mainnet design avoids by simply having 1,342 events in total.
 */
export function remove(cer: Ceremony): void {
  const roots = cer.roots
  for (let i = 0; i < roots.length; i++) {
    store.remove("RootTally", cer.id + "-" + roots[i].toHexString())
  }
  store.remove("Ceremony", cer.id)
}
