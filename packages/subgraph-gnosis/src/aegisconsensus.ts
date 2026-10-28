import { TransactionProposed, TransactionAttested, EpochRolledOver, ValidatorStakerSet } from "../generated/AegisConsensus/AegisConsensus"
import { consensus, AEGIS } from "./shared"
import { onTransactionProposed, onTransactionAttested, onEpochRolledOver, onValidatorStakerSet } from "./handlers"

/**
 * Aegis's consensus contract. Its transaction events carry, in place of Beta's chain id and Safe,
 * the safeId, which packs the two, and the oracle that checked the transaction.
 */
function proposalKey(hash: string, safeId: string, oracle: string): string {
  return hash + "-" + safeId + "-" + oracle
}

export function handleTransactionProposed(event: TransactionProposed): void {
  const key = proposalKey(event.params.safeTxHash.toHexString(), event.params.safeId.toHexString(), event.params.oracle.toHexString())
  onTransactionProposed(consensus(AEGIS), key, event.block.number, event.block.timestamp)
}

export function handleTransactionAttested(event: TransactionAttested): void {
  const key = proposalKey(event.params.safeTxHash.toHexString(), event.params.safeId.toHexString(), event.params.oracle.toHexString())
  onTransactionAttested(consensus(AEGIS), key, event.params.signatureId, event.block.number, event.block.timestamp)
}

export function handleEpochRolledOver(event: EpochRolledOver): void {
  onEpochRolledOver(consensus(AEGIS), event.params.newActiveEpoch)
}

export function handleValidatorStakerSet(event: ValidatorStakerSet): void {
  onValidatorStakerSet(consensus(AEGIS), event.params.validator, event.params.staker, event.block.number)
}
