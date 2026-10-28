import { SignShared, SignCompleted, KeyGenConfirmed } from "../generated/FROSTCoordinator/FROSTCoordinator"
import { consensus, BETA } from "./shared"
import { onSignShared, onSignCompleted, onKeyGenConfirmed } from "./handlers"

/** Beta's FROST coordinator. */
export function handleSignShared(event: SignShared): void {
  onSignShared(consensus(BETA), event.params.sid, event.params.selectionRoot, event.params.participant, event.block.number)
}

export function handleSignCompleted(event: SignCompleted): void {
  onSignCompleted(consensus(BETA), event.params.sid, event.params.selectionRoot, event.block.number)
}

export function handleKeyGenConfirmed(event: KeyGenConfirmed): void {
  onKeyGenConfirmed(consensus(BETA), event.params.participant, event.block.number)
}
