import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import {
  Consensus, SigningValidator, ValidatorDay, ConsensusDay, ValidatorHour, ConsensusHour, Ceremony, RootTally,
  CountedCeremony,
} from "../generated/schema"

export const ZERO = BigInt.fromI32(0)
export const ONE = BigInt.fromI32(1)
const DAY = 86400
const HOUR = 3600

/**
 * How many blocks a CountedCeremony is kept after its count, to recognise a late event for it.
 *
 * No late event has been seen. Over 16 days to block 48,602,061, 70,524 attestations: every
 * TransactionAttested sat in the same transaction as its SignCompleted, after it; no sid was
 * completed or attested twice; no SignShared came after its SignCompleted. The logs cannot show
 * the contract never will, so the guard stays, bounded. 1,000 blocks, about 1.4 hours, is
 * almost four times the longest span seen from a ceremony's first share to its completion,
 * 260 blocks.
 */
export const COUNTED_HORIZON = 1000

/** The oracle's MAX_EXPECTED_LATENCY. Beyond it a sample is excluded, as the oracle excludes it. */
export const MAX_LATENCY = 64

/**
 * The programmes, as `Programme` in packages/core names them. Each data source's mapping passes
 * its own; every row it writes carries it.
 */
export const BETA = "beta"
export const AEGIS = "aegis"

/** The totals of one programme. Every other row of that programme is keyed through `c.id`. */
export function consensus(programme: string): Consensus {
  let c = Consensus.load(programme)
  if (c == null) {
    c = new Consensus(programme)
    c.programme = programme
    c.attestationCeremonies = ZERO
    c.nonAttestationCeremonies = ZERO
    c.attestations = ZERO
    c.proposals = ZERO
    c.latencySamples = ZERO
    c.epochRollovers = 0
    c.openCeremonies = 0
    c.validatorCount = 0
    c.validators = []
    c.countedOldest = null
    c.countedNewest = null
  }
  return c as Consensus
}

/**
 * The validator at `addr`, created on first sight, and added to the validators of `c`'s
 * programme the first time that programme's contracts show it. A Beta validator seen again on
 * Aegis is the same row, and joins Aegis's list then, not before.
 *
 * `block` is where it was seen. lastSeenBlock only moves forward: a caller may pass a block
 * older than one already recorded, and that must not rewind it.
 */
export function signingValidator(addr: Bytes, block: BigInt, c: Consensus): SigningValidator {
  const id = addr.toHexString()
  let v = SigningValidator.load(id)
  if (v == null) {
    v = new SigningValidator(id)
    v.address = addr
    v.attended = ZERO
    v.firstSeenBlock = block
    v.lastSeenBlock = block
  } else if (block.gt(v.lastSeenBlock)) {
    v.lastSeenBlock = block
  }
  // A handful of validators per programme, so a scan is cheaper than a membership row.
  const known = c.validators
  let listed = false
  for (let i = 0; i < known.length; i++) {
    if (known[i] == id) { listed = true; break }
  }
  if (!listed) {
    known.push(id)
    c.validators = known
    c.validatorCount = c.validatorCount + 1
  }
  return v as SigningValidator
}

// dayStart and hourStart key on ts.toI32(), which overflows on 2038-01-19.
export function dayStart(ts: BigInt): i32 {
  return (ts.toI32() / DAY) * DAY
}

export function hourStart(ts: BigInt): i32 {
  return (ts.toI32() / HOUR) * HOUR
}

export function consensusHour(c: Consensus, hour: i32): ConsensusHour {
  const id = c.id + "-" + hour.toString()
  let h = ConsensusHour.load(id)
  if (h == null) {
    h = new ConsensusHour(id)
    h.programme = c.programme
    h.hour = hour
    h.attestationCeremonies = 0
    h.attestationCeremoniesOnTheHour = 0
  }
  return h as ConsensusHour
}

export function validatorHour(c: Consensus, validatorId: string, hour: i32): ValidatorHour {
  const id = c.id + "-" + validatorId + "-" + hour.toString()
  let h = ValidatorHour.load(id)
  if (h == null) {
    h = new ValidatorHour(id)
    h.programme = c.programme
    h.validator = validatorId
    h.hour = hour
    h.ceremonies = 0
    h.attended = 0
    h.missed = 0
    h.ceremoniesOnTheHour = 0
    h.attendedOnTheHour = 0
    h.missedOnTheHour = 0
  }
  return h as ValidatorHour
}

export function validatorDay(c: Consensus, v: SigningValidator, ts: BigInt): ValidatorDay {
  const day = dayStart(ts)
  const id = c.id + "-" + v.id + "-" + day.toString()
  let d = ValidatorDay.load(id)
  if (d == null) {
    d = new ValidatorDay(id)
    d.programme = c.programme
    d.validator = v.id
    d.date = day
    d.attended = ZERO
  }
  return d as ValidatorDay
}

export function consensusDay(c: Consensus, ts: BigInt): ConsensusDay {
  const day = dayStart(ts)
  const id = c.id + "-" + day.toString()
  let d = ConsensusDay.load(id)
  if (d == null) {
    d = new ConsensusDay(id)
    d.programme = c.programme
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

/**
 * The open ceremony `sid`, opened on its first event. Null when `sid` was counted within the
 * last COUNTED_HORIZON blocks: the count is final, and opening a new Ceremony for a late event
 * would leave a row that nothing ever completes, counted in openCeremonies forever.
 *
 * The counted set is read only when no Ceremony row exists, so an open ceremony costs no
 * extra lookup per event.
 */
export function ceremony(sid: Bytes, block: BigInt, c: Consensus): Ceremony | null {
  const id = c.id + "-" + sid.toHexString()
  let cer = Ceremony.load(id)
  if (cer == null) {
    if (CountedCeremony.load(id) != null) return null
    cer = new Ceremony(id)
    cer.programme = c.programme
    cer.isAttestation = false
    cer.counted = false
    cer.countedAsNonAttestation = false
    cer.roots = []
    cer.firstSeenBlock = block
    cer.attestedAtBlock = null
    cer.attestedAtTimestamp = null
    c.openCeremonies = c.openCeremonies + 1
  }
  return cer
}

/**
 * Records the ceremony `sid`, a Ceremony id, as counted at `block`, newest last, then removes the records older than
 * COUNTED_HORIZON blocks from the front of the queue.
 */
function markCounted(sid: string, block: BigInt, c: Consensus): void {
  const t = new CountedCeremony(sid)
  t.countedAtBlock = block
  t.next = null
  t.save()
  const newest = c.countedNewest
  if (newest !== null) {
    const prev = CountedCeremony.load(newest)
    if (prev != null) {
      prev.next = sid
      prev.save()
    }
  }
  c.countedNewest = sid
  if (c.countedOldest === null) c.countedOldest = sid

  const cutoff = block.minus(BigInt.fromI32(COUNTED_HORIZON))
  let oldest = c.countedOldest
  while (oldest !== null) {
    const o = CountedCeremony.load(oldest)
    if (o == null || o.countedAtBlock.ge(cutoff)) break
    store.remove("CountedCeremony", oldest)
    oldest = o.next
  }
  c.countedOldest = oldest
  if (oldest === null) c.countedNewest = null
}

/**
 * Count a ceremony once both facts are known, then delete what it needed.
 *
 * Two events supply those facts. Every one of 70,524 attestations measured over 16 days to block
 * 48,602,061 sat in the same transaction as its SignCompleted, after it, but nothing known
 * enforces that, so neither order is assumed:
 *
 *   SignCompleted        the winning selectionRoot. Shares for a losing root do not count
 *                        and shares are emitted before completion.
 *   TransactionAttested  that the ceremony was a transaction attestation. About 1 in 400 is
 *                        not, and the oracle excludes those from participation.
 *
 * Whichever handler makes the pair complete calls this, with its own block. It is idempotent.
 *
 * The counting rules are metrics-poc.ts's, which reproduces SEF's published rates bit for bit:
 *
 *   - What closes a ceremony: its TransactionAttested, joined on signatureId, together with a
 *     SignCompleted for the same sid. A ceremony with no attestation is not counted.
 *   - Where it is filed: under the block of its TransactionAttested, in every bucket, hourly
 *     and daily. Not the first share's block, and not the block of whichever event arrived
 *     second. metrics-poc.ts takes a ceremony into the window when both events are in it; they
 *     have sat in the same transaction every time it was measured, so the two rules agree, and
 *     the attestation block is the one SEF names.
 *   - Who attended: each participant with a SignShared for the sid under the WINNING root, at
 *     or before the count. A share for a losing root does not count, nor does one after it.
 *   - Who missed: every other validator in Consensus.validators at the count. A validator not
 *     yet seen is not given a miss.
 */
export function tryCount(cer: Ceremony, c: Consensus, block: BigInt): void {
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

  // Set by handleTransactionAttested together with isAttestation, so never null here.
  const at = cer.attestedAtTimestamp!
  const hour = hourStart(at)
  const onTheHour = at.toI32() == hour ? 1 : 0

  const ch = consensusHour(c, hour)
  ch.attestationCeremonies = ch.attestationCeremonies + 1
  ch.attestationCeremoniesOnTheHour = ch.attestationCeremoniesOnTheHour + onTheHour
  ch.save()

  const day = consensusDay(c, at)
  day.attestationCeremonies = day.attestationCeremonies.plus(ONE)
  day.save()

  const winner = RootTally.load(cer.id + "-" + root.toHexString())
  const present = winner != null ? winner.participants : new Array<Bytes>()
  const known = c.validators
  for (let i = 0; i < known.length; i++) {
    const v = SigningValidator.load(known[i])!
    let attended = false
    for (let j = 0; j < present.length; j++) {
      if (present[j].equals(v.address)) { attended = true; break }
    }
    const vh = validatorHour(c, v.id, hour)
    vh.ceremonies = vh.ceremonies + 1
    vh.ceremoniesOnTheHour = vh.ceremoniesOnTheHour + onTheHour
    if (attended) {
      vh.attended = vh.attended + 1
      vh.attendedOnTheHour = vh.attendedOnTheHour + onTheHour
      v.attended = v.attended.plus(ONE)
      v.save()
      const vd = validatorDay(c, v, at)
      vd.attended = vd.attended.plus(ONE)
      vd.save()
    } else {
      vh.missed = vh.missed + 1
      vh.missedOnTheHour = vh.missedOnTheHour + onTheHour
    }
    vh.save()
  }

  c.openCeremonies = c.openCeremonies - 1
  markCounted(cer.id, block, c)
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
