import { Bytes } from "@graphprotocol/graph-ts"
import { SignShared, SignCompleted, KeyGenConfirmed } from "../generated/FROSTCoordinator/FROSTCoordinator"
import { RootTally } from "../generated/schema"
import { consensus, ceremony, signingValidator, tryCount, ONE } from "./shared"

/**
 * A participant published their share for one selectionRoot.
 *
 * The share cannot be counted yet: only the WINNING root counts (D-057), and the winner is
 * not known until SignCompleted. So the participant is recorded against the root it chose,
 * and the tally is read when the ceremony completes.
 *
 * The oracle measures first share to completion at a median of 1 block, p99 4, max 10. So
 * these rows live for a handful of blocks, not indefinitely.
 */
export function handleSignShared(event: SignShared): void {
  const c = consensus()
  const cer = ceremony(event.params.sid, event.block.number, event.block.timestamp, c)

  const root = event.params.selectionRoot
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
  const who = event.params.participant
  const seen = t.participants
  let already = false
  for (let i = 0; i < seen.length; i++) {
    if (seen[i].equals(who)) { already = true; break }
  }
  if (!already) {
    seen.push(who as Bytes)
    t.participants = seen
  }
  t.save()

  // Seeing a share is enough to know the validator exists, even before it attends anything.
  const v = signingValidator(who, event.block.number, c)
  v.save()

  cer.save()
  c.save()
}

/** The ceremony produced a signature. This names the winning root. */
export function handleSignCompleted(event: SignCompleted): void {
  const c = consensus()
  const cer = ceremony(event.params.sid, event.block.number, event.block.timestamp, c)

  cer.winningRoot = event.params.selectionRoot
  cer.save()

  tryCount(cer, c)
  c.save()
}

/** Key generation. Kept because it names participants; not used by any promised metric. */
export function handleKeyGenConfirmed(event: KeyGenConfirmed): void {
  const c = consensus()
  const v = signingValidator(event.params.participant, event.block.number, c)
  v.save()
  c.save()
}
