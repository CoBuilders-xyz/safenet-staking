import type { Address, Hash } from "viem"
import { rewardPeriodWindows, attributeRewardClaims, compareRewardPeriodEnds, RewardPeriodDataError } from "@cobuilders/safenet-core"
import { RewardHistoryClaimsDocument, RewardHistoryPeriodsDocument } from "@/graphql/mainnet/generated"
import { assessFreshness, fetchSubgraph, type Freshness } from "@/lib/subgraph"

/** A fixed window bounds both the response size and archive RPC work on a phone. */
export const REWARD_HISTORY_PERIOD_LIMIT = 12
export const REWARD_HISTORY_CLAIM_LIMIT = 1000

export type HistoryFailure = "unavailable" | "incomplete" | "stale"
export class RewardHistoryError extends Error {
  readonly reason: HistoryFailure
  constructor(reason: HistoryFailure) {
    super(reason)
    this.reason = reason
  }
}

export interface RewardHistoryRow {
  period: number
  startBlock: bigint
  endBlock: bigint
  timestamp: number
  transaction: Hash
  claims: number
  claimed: bigint
}

export interface RewardHistory {
  rows: RewardHistoryRow[]
  freshness: Freshness
  totalPeriods: number
}

/** Only reads. The caller binds these to the configured Mainnet MerkleDrop and account. */
export interface RewardHistoryChain {
  cumulativeClaimed: (block: bigint) => Promise<bigint>
  merkleRoot: (block: bigint) => Promise<string>
}

const incomplete = (): never => { throw new RewardHistoryError("incomplete") }
function checkFreshness(freshness: Freshness) {
  if (assessFreshness(freshness)) throw new RewardHistoryError("stale")
}

/**
 * Claims during the latest root lifetimes, not earnings allocated for those periods.
 * Whole-block windows cannot resolve the order of claims and root updates in the same block.
 * Check every cumulative prefix and each window end against the archive chain. A missing
 * payment, truncated page, malformed boundary or mismatch produces no numeric history.
 */
async function readHistory(
  url: string, address: Address, chain: RewardHistoryChain, signal?: AbortSignal,
): Promise<RewardHistory> {
  const first = await fetchSubgraph(url, RewardHistoryPeriodsDocument, { limit: REWARD_HISTORY_PERIOD_LIMIT }, signal)
  checkFreshness(first.freshness)
  const head = BigInt(first.freshness.block)
  const periods = [...first.data.rewardPeriods].reverse()
  const totalPeriods = first.data.network?.rewardPeriods
  const windows = rewardPeriodWindows(periods, head, totalPeriods, REWARD_HISTORY_PERIOD_LIMIT)
  const from = windows[0]!.startBlock
  const claims = await fetchSubgraph(url, RewardHistoryClaimsDocument, {
    account: address.toLowerCase(), from: from.toString(),
    block: { number: first.freshness.block }, limit: REWARD_HISTORY_CLAIM_LIMIT,
  }, signal)
  // graph-node returns timestamp: null for _meta(block: { number }), even when the head
  // query reports it. The pinned block inherits that head's verified age, not a new clock.
  if (claims.freshness.hasIndexingErrors) throw new RewardHistoryError("stale")
  if (claims.freshness.block !== first.freshness.block
    || (claims.freshness.blockTimestamp !== null && claims.freshness.blockTimestamp !== first.freshness.blockTimestamp)
    || claims.data.rewardClaims.length >= REWARD_HISTORY_CLAIM_LIMIT) incomplete()
  signal?.throwIfAborted()
  const [baseline, root] = await Promise.all([chain.cumulativeClaimed(from - 1n), chain.merkleRoot(head)])
  if (root.toLowerCase() !== periods.at(-1)!.root.toLowerCase()) incomplete()
  const attributed = attributeRewardClaims(windows, claims.data.rewardClaims, baseline, address)
  const rows: RewardHistoryRow[] = attributed.map((r) => ({
    period: r.distribution.period, startBlock: r.startBlock, endBlock: r.endBlock,
    timestamp: Number(r.distribution.timestamp), transaction: r.distribution.transactionHash as Hash,
    claims: r.claims, claimed: r.claimed,
  }))
  // Four concurrent archive calls at most; the entire request has a caller-owned deadline.
  const ends: bigint[] = []
  for (let i = 0; i < rows.length; i += 4) {
    signal?.throwIfAborted()
    ends.push(...await Promise.all(rows.slice(i, i + 4).map((r) => chain.cumulativeClaimed(r.endBlock))))
  }
  if (compareRewardPeriodEnds(attributed, ends).some((comparison) => !comparison.match)) incomplete()
  return { rows: rows.reverse(), freshness: first.freshness, totalPeriods: totalPeriods! }
}

/** Map shared data validation failures to the web's explicit incomplete state. */
export async function readRewardHistory(
  url: string, address: Address, chain: RewardHistoryChain, signal?: AbortSignal,
): Promise<RewardHistory> {
  try {
    return await readHistory(url, address, chain, signal)
  } catch (error) {
    if (error instanceof RewardPeriodDataError) incomplete()
    throw error
  }
}
