/**
 * What every Gnosis event does, for either programme. Each data source's mapping reads its own
 * generated event, which differs between Beta and Aegis for the two transaction events, and
 * passes the fields here with its programme's Consensus row.
 */
import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import { Consensus, PendingProposal, RootTally } from "../generated/schema"
import { ceremony, consensusDay, signingValidator, tryCount, MAX_LATENCY, ONE } from "./shared"

/**
 * A transaction was proposed. Held so its attestation can be timed against it. `key` is the
 * PendingProposal id without the programme: the indexed parameters both events carry.
 */
export function onTransactionProposed(c: Consensus, key: string, block: BigInt, timestamp: BigInt): void {
  c.proposals = c.proposals.plus(ONE)
  c.save()

  const p = new PendingProposal(c.id + "-" + key)
  p.proposedAtBlock = block
  p.proposedAtTimestamp = timestamp
  p.save()
}

/**
 * A transaction was attested.
 *
 * Two jobs. First, measure latency against the stored proposal. Second, mark the ceremony
 * named by signatureId as an attestation, which is the filter the oracle applies: about one
 * ceremony in 400 completes without one on Beta, and does not count toward participation.
 */
export function onTransactionAttested(
  c: Consensus, key: string, signatureId: Bytes, block: BigInt, timestamp: BigInt,
): void {
  c.attestations = c.attestations.plus(ONE)

  const day = consensusDay(c, timestamp)
  day.attestations = day.attestations.plus(ONE)

  const id = c.id + "-" + key
  const p = PendingProposal.load(id)
  if (p != null) {
    const delta = block.minus(p.proposedAtBlock).toI32()
    if (delta >= 0 && delta <= MAX_LATENCY) {
      const buckets = day.latencyBuckets
      buckets[delta] = buckets[delta].plus(ONE)
      day.latencyBuckets = buckets
      day.latencySamples = day.latencySamples.plus(ONE)
      c.latencySamples = c.latencySamples.plus(ONE)
    } else {
      // Beyond the oracle's MAX_EXPECTED_LATENCY. Recorded, not counted, so the two agree.
      day.latencyOverflow = day.latencyOverflow.plus(ONE)
    }
    // The proposal has served its purpose. Leaving it would grow this table by about
    // 4,900 rows a day forever.
    store.remove("PendingProposal", id)
  }
  day.save()

  // A second attestation of a ceremony already counted is still an attestation, counted
  // above, but it cannot count the ceremony again or open it anew.
  const cer = ceremony(signatureId, block, c)
  if (cer == null) {
    c.save()
    return
  }
  // The first attestation names the block the ceremony is filed under. A second one before the
  // count, which no log has shown, does not move it.
  if (!cer.isAttestation) {
    cer.attestedAtBlock = block
    cer.attestedAtTimestamp = timestamp
  }
  cer.isAttestation = true
  cer.save()

  tryCount(cer, c, block)
  c.save()
}

export function onEpochRolledOver(c: Consensus, newActiveEpoch: BigInt): void {
  c.epochRollovers = c.epochRollovers + 1
  // graph-ts maps uint64 to BigInt, so no conversion is needed or correct here.
  c.currentEpoch = newActiveEpoch
  c.save()
}

/** The Mainnet staker a validator signs for. Rare: set once at registration. */
export function onValidatorStakerSet(c: Consensus, validator: Bytes, staker: Bytes, block: BigInt): void {
  const v = signingValidator(validator, block, c)
  v.staker = staker
  v.save()
  c.save()
}

/**
 * A participant published their share for one selectionRoot.
 *
 * The share cannot be counted yet: only the WINNING root counts, and the winner is
 * not known until SignCompleted. So the participant is recorded against the root it chose,
 * and the tally is read when the ceremony completes.
 *
 * The oracle measures first share to completion at a median of 1 block, p99 4, max 10. So
 * these rows live for a handful of blocks, not indefinitely.
 */
export function onSignShared(c: Consensus, sid: Bytes, root: Bytes, who: Bytes, block: BigInt): void {
  // Seeing a share is enough to know the validator exists, even before it attends anything.
  const v = signingValidator(who, block, c)
  v.save()

  // A share for a ceremony already counted cannot change the count. It is not opened again.
  const cer = ceremony(sid, block, c)
  if (cer == null) {
    c.save()
    return
  }

  const tallyId = cer.id + "-" + root.toHexString()

  let t = RootTally.load(tallyId)
  if (t == null) {
    t = new RootTally(tallyId)
    t.ceremony = cer.id
    t.root = root
    t.participants = []
    // Track every root seen, so all tallies can be deleted when the ceremony is counted.
    const roots = cer.roots
    roots.push(root)
    cer.roots = roots
  }

  // A participant could in principle share twice for one root. Counting them twice would
  // overstate attendance, which is the class of error the Mainnet subgraph already produced.
  const seen = t.participants
  let already = false
  for (let i = 0; i < seen.length; i++) {
    if (seen[i].equals(who)) { already = true; break }
  }
  if (!already) {
    seen.push(who)
    t.participants = seen
  }
  t.save()

  cer.save()
  c.save()
}

/** The ceremony produced a signature. This names the winning root. */
export function onSignCompleted(c: Consensus, sid: Bytes, root: Bytes, block: BigInt): void {
  const cer = ceremony(sid, block, c)
  if (cer == null) return

  cer.winningRoot = root
  cer.save()

  tryCount(cer, c, block)
  c.save()
}

/** Key generation. Kept because it names participants; not used by any promised metric. */
export function onKeyGenConfirmed(c: Consensus, participant: Bytes, block: BigInt): void {
  const v = signingValidator(participant, block, c)
  v.save()
  c.save()
}
