import { BigInt } from "@graphprotocol/graph-ts"
import { TransactionProposed, TransactionAttested, EpochRolledOver, ValidatorStakerSet } from "../generated/Consensus/Consensus"
import { consensus, BETA } from "./shared"
import { onTransactionProposed, onTransactionAttested, onEpochRolledOver, onValidatorStakerSet } from "./handlers"

/** Beta's consensus contract. Its transaction events carry the chain id and the Safe. */
function proposalKey(hash: string, chainId: BigInt, safe: string): string {
  return hash + "-" + chainId.toString() + "-" + safe
}

export function handleTransactionProposed(event: TransactionProposed): void {
  const key = proposalKey(event.params.safeTxHash.toHexString(), event.params.chainId, event.params.safe.toHexString())
  onTransactionProposed(consensus(BETA), key, event.block.number, event.block.timestamp)
}

export function handleTransactionAttested(event: TransactionAttested): void {
  const key = proposalKey(event.params.safeTxHash.toHexString(), event.params.chainId, event.params.safe.toHexString())
  onTransactionAttested(consensus(BETA), key, event.params.signatureId, event.block.number, event.block.timestamp)
}

export function handleEpochRolledOver(event: EpochRolledOver): void {
  onEpochRolledOver(consensus(BETA), event.params.newActiveEpoch)
}

export function handleValidatorStakerSet(event: ValidatorStakerSet): void {
  onValidatorStakerSet(consensus(BETA), event.params.validator, event.params.staker, event.block.number)
}
