import { BigInt, store } from "@graphprotocol/graph-ts"
import { TransactionProposed, TransactionAttested, EpochRolledOver, ValidatorStakerSet } from "../generated/Consensus/Consensus"
import { PendingProposal } from "../generated/schema"
import { consensus, ceremony, consensusDay, signingValidator, tryCount, MAX_LATENCY, ONE } from "./shared"

function proposalId(hash: string, chainId: BigInt, safe: string): string {
  return hash + "-" + chainId.toString() + "-" + safe
}

/** A transaction was proposed. Held so its attestation can be timed against it. */
export function handleTransactionProposed(event: TransactionProposed): void {
  const c = consensus()
  c.proposals = c.proposals.plus(ONE)
  c.save()

  const id = proposalId(
    event.params.safeTxHash.toHexString(),
    event.params.chainId,
    event.params.safe.toHexString(),
  )
  const p = new PendingProposal(id)
  p.proposedAtBlock = event.block.number
  p.proposedAtTimestamp = event.block.timestamp
  p.save()
}

/**
 * A transaction was attested.
 *
 * Two jobs. First, measure latency against the stored proposal. Second, mark the ceremony
 * named by signatureId as an attestation, which is the filter the oracle applies: about one
 * ceremony in 400 completes without one and does not count toward participation.
 */
export function handleTransactionAttested(event: TransactionAttested): void {
  const c = consensus()
  c.attestations = c.attestations.plus(ONE)

  const day = consensusDay(event.block.timestamp)
  day.attestations = day.attestations.plus(ONE)

  const id = proposalId(
    event.params.safeTxHash.toHexString(),
    event.params.chainId,
    event.params.safe.toHexString(),
  )
  const p = PendingProposal.load(id)
  if (p != null) {
    const delta = event.block.number.minus(p.proposedAtBlock).toI32()
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
  const cer = ceremony(event.params.signatureId, event.block.number, c)
  if (cer == null) {
    c.save()
    return
  }
  // The first attestation names the block the ceremony is filed under. A second one before the
  // count, which no log has shown, does not move it.
  if (!cer.isAttestation) {
    cer.attestedAtBlock = event.block.number
    cer.attestedAtTimestamp = event.block.timestamp
  }
  cer.isAttestation = true
  cer.save()

  tryCount(cer, c, event.block.number)
  c.save()
}

export function handleEpochRolledOver(event: EpochRolledOver): void {
  const c = consensus()
  c.epochRollovers = c.epochRollovers + 1
  // graph-ts maps uint64 to BigInt, so no conversion is needed or correct here.
  c.currentEpoch = event.params.newActiveEpoch
  c.save()
}

/** The Mainnet staker a validator signs for. Rare: set once at registration. */
export function handleValidatorStakerSet(event: ValidatorStakerSet): void {
  const c = consensus()
  const v = signingValidator(event.params.validator, event.block.number, c)
  v.staker = event.params.staker
  v.save()
  c.save()
}
