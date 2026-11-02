import type { Address, Hash } from "viem"
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
export async function readRewardHistory(
  url: string, address: Address, chain: RewardHistoryChain, signal?: AbortSignal,
): Promise<RewardHistory> {
  const first = await fetchSubgraph(url, RewardHistoryPeriodsDocument, { limit: REWARD_HISTORY_PERIOD_LIMIT }, signal)
  checkFreshness(first.freshness)
  const head = BigInt(first.freshness.block)
  const periods = [...first.data.rewardPeriods].reverse()
  const totalPeriods = first.data.network?.rewardPeriods
  if (!Number.isSafeInteger(totalPeriods) || !totalPeriods || totalPeriods < 0
    || periods.length !== Math.min(totalPeriods, REWARD_HISTORY_PERIOD_LIMIT)) incomplete()
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]!
    const start = BigInt(p.blockNumber)
    if (p.period !== totalPeriods! - periods.length + i + 1 || start <= 0n || start > head
      || (i > 0 && start <= BigInt(periods[i - 1]!.blockNumber))
      || !Number.isSafeInteger(Number(p.timestamp)) || Number(p.timestamp) < 0
      || Number.isNaN(new Date(Number(p.timestamp) * 1000).getTime())) incomplete()
  }
  const from = BigInt(periods[0]!.blockNumber)
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
  const seen = new Set<string>()
  const ordered = claims.data.rewardClaims.map((c) => {
    if (seen.has(c.id) || c.account.toLowerCase() !== address.toLowerCase()) incomplete()
    seen.add(c.id)
    return { block: BigInt(c.blockNumber), amount: BigInt(c.amount), cumulative: BigInt(c.cumulativeAmount) }
  }).sort((a, b) => a.block !== b.block ? (a.block < b.block ? -1 : 1)
    : a.cumulative < b.cumulative ? -1 : a.cumulative > b.cumulative ? 1 : 0)

  signal?.throwIfAborted()
  const [baseline, root] = await Promise.all([chain.cumulativeClaimed(from - 1n), chain.merkleRoot(head)])
  if (baseline < 0n || root.toLowerCase() !== periods.at(-1)!.root.toLowerCase()) incomplete()
  let cumulative = baseline
  for (const c of ordered) {
    cumulative += c.amount
    if (c.block < from || c.block > head || c.amount < 0n || c.cumulative !== cumulative) incomplete()
  }
  const rows = periods.map((p, i): RewardHistoryRow => {
    const startBlock = BigInt(p.blockNumber)
    const endBlock = i + 1 < periods.length ? BigInt(periods[i + 1]!.blockNumber) - 1n : head
    const window = ordered.filter((c) => c.block >= startBlock && c.block <= endBlock)
    return {
      period: p.period, startBlock, endBlock, timestamp: Number(p.timestamp),
      transaction: p.transactionHash as Hash, claims: window.length,
      claimed: window.reduce((sum, c) => sum + c.amount, 0n),
    }
  })
  // Four concurrent archive calls at most; the entire request has a caller-owned deadline.
  const ends: bigint[] = []
  for (let i = 0; i < rows.length; i += 4) {
    signal?.throwIfAborted()
    ends.push(...await Promise.all(rows.slice(i, i + 4).map((r) => chain.cumulativeClaimed(r.endBlock))))
  }
  cumulative = baseline
  for (let i = 0; i < rows.length; i++) {
    cumulative += rows[i]!.claimed
    if (cumulative !== ends[i]) incomplete()
  }
  return { rows: rows.reverse(), freshness: first.freshness, totalPeriods: totalPeriods! }
}
