/**
 * The block at an instant, by binary search on block timestamps.
 *
 * Taken from scripts/metrics-poc.ts, which needs the same edges to reproduce SEF's window bit
 * for bit. The timestamp lookup is an argument, so blocks.test.ts runs it without a chain.
 *
 *   side "first" -> first block with timestamp >= target   (an inclusive window start)
 *   side "last"  -> last  block with timestamp <= target   (an inclusive window end, or the
 *                                                            state at an instant)
 *
 * Using "last" for both edges includes one block before the window whenever no block lands
 * exactly on the boundary second, which breaks bit-exactness with no diagnostic.
 */
export async function blockAtTimestamp(opts: {
  timestampOf: (block: bigint) => Promise<bigint>
  /** A block known to be at or before the answer, such as a deploy block. */
  lo: bigint
  /** The chain head. */
  hi: bigint
  /** Unix seconds. */
  target: bigint
  side: "first" | "last"
}): Promise<bigint> {
  const { timestampOf, target, side } = opts
  let { lo, hi } = opts
  // Never clamp silently. A head before the instant means the node is behind; a floor after it
  // means the instant predates what we may search.
  const [loTs, hiTs] = await Promise.all([timestampOf(lo), timestampOf(hi)])
  if (hiTs < target) {
    throw new Error(`the chain head, block ${hi}, is at ${iso(hiTs)}, before ${iso(target)}: the node is behind`)
  }
  if (loTs > target) {
    throw new Error(`block ${lo} is at ${iso(loTs)}, after ${iso(target)}: the instant is before the search floor`)
  }
  while (lo < hi) {
    const mid = side === "last" ? (lo + hi + 1n) / 2n : (lo + hi) / 2n
    const ts = await timestampOf(mid)
    if (side === "last") {
      if (ts <= target) lo = mid
      else hi = mid - 1n
    } else if (ts >= target) hi = mid
    else lo = mid + 1n
  }
  return lo
}

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString()
