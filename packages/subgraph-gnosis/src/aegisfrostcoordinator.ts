import { SignShared, SignCompleted, KeyGenConfirmed } from "../generated/AegisFROSTCoordinator/AegisFROSTCoordinator"
import { consensus, AEGIS } from "./shared"
import { onSignShared, onSignCompleted, onKeyGenConfirmed } from "./handlers"

/** Aegis's FROST coordinator. The same three events as Beta's, at its own address. */
export function handleSignShared(event: SignShared): void {
  onSignShared(consensus(AEGIS), event.params.sid, event.params.selectionRoot, event.params.participant, event.block.number)
}

export function handleSignCompleted(event: SignCompleted): void {
  onSignCompleted(consensus(AEGIS), event.params.sid, event.params.selectionRoot, event.block.number)
}

export function handleKeyGenConfirmed(event: KeyGenConfirmed): void {
  onKeyGenConfirmed(consensus(AEGIS), event.params.participant, event.block.number)
}
