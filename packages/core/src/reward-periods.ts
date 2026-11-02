/**
 * Shared, browser-safe claim attribution for the web, CLI and MCP readers.
 * Windows approximate root lifetimes with whole blocks. A claim before a root update in
 * the same block enters the new window too: the schema has no root-update log index.
 * These are claimed payments, never earnings allocated to a distribution period.
 * Callers own transport, page limits, freshness and presentation of chain mismatches.
 */
export interface RewardPeriodRecord {
  readonly period: number
  readonly blockNumber: string
  readonly timestamp: string
}

export interface RewardClaimRecord {
  readonly blockNumber: string
  readonly amount: string
  readonly cumulativeAmount: string
  readonly id?: string
  readonly account?: string
}

export interface RewardPeriodWindow<T extends RewardPeriodRecord> {
  readonly distribution: T
  readonly startBlock: bigint
  readonly endBlock: bigint
  readonly current: boolean
}

export interface AttributedRewardPeriod<T extends RewardPeriodRecord> extends RewardPeriodWindow<T> {
  readonly claims: number
  readonly claimed: bigint
  readonly subgraph: bigint
}

/** Fixed messages do not include provider data or endpoint credentials. */
export class RewardPeriodDataError extends Error {}

function invalid(message: string): never {
  throw new RewardPeriodDataError(`the subgraph returned ${message}`)
}

function integer(value: string, message: string): bigint {
  if (!/^-?\d+$/.test(value)) invalid(message)
  return BigInt(value)
}

/** Ascending, contiguous distributions, either all of them or the latest bounded suffix. */
export function rewardPeriodWindows<T extends RewardPeriodRecord>(
  periods: readonly T[], head: bigint, totalPeriods: number | null | undefined, limit?: number,
): RewardPeriodWindow<T>[] {
  if (periods.length === 0) invalid("no reward periods")
  if (!Number.isSafeInteger(totalPeriods) || !totalPeriods || totalPeriods < 0
    || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    || periods.length !== Math.min(totalPeriods, limit ?? totalPeriods)
    || periods.some((p, i) => p.period !== totalPeriods - periods.length + i + 1)) {
    invalid("incomplete or inconsistent reward periods")
  }
  const boundaries = periods.map((p) => integer(p.blockNumber, "inconsistent reward period boundaries"))
  return periods.map((distribution, i) => {
    const startBlock = boundaries[i]!
    const timestamp = Number(distribution.timestamp)
    if (startBlock <= 0n || startBlock > head || (i > 0 && startBlock <= boundaries[i - 1]!)
      || !/^\d+$/.test(distribution.timestamp) || !Number.isSafeInteger(timestamp)
      || Number.isNaN(new Date(timestamp * 1000).getTime())) {
      invalid("inconsistent reward period boundaries")
    }
    return { distribution, startBlock, endBlock: boundaries[i + 1] === undefined ? head : boundaries[i + 1]! - 1n,
      current: i === periods.length - 1 }
  })
}

/**
 * Reconstruct every cumulative prefix, including the archive baseline for a bounded suffix.
 * Sorting cumulative totals resolves query ties, not event ordering around a root update.
 * An account argument also requires unique entity IDs and matching account identities.
 */
export function attributeRewardClaims<T extends RewardPeriodRecord>(
  windows: readonly RewardPeriodWindow<T>[], claims: readonly RewardClaimRecord[],
  baseline = 0n, account?: string,
): AttributedRewardPeriod<T>[] {
  const message = "incomplete or inconsistent reward claims"
  if (!windows.length || baseline < 0n) invalid(message)
  const seen = new Set<string>()
  const ordered = claims.map((c) => {
    if (account !== undefined) {
      if (!c.id || seen.has(c.id) || c.account?.toLowerCase() !== account.toLowerCase()) invalid(message)
      seen.add(c.id)
    }
    return {
      block: integer(c.blockNumber, message), amount: integer(c.amount, message),
      cumulative: integer(c.cumulativeAmount, message),
    }
  }).sort((a, b) => a.block !== b.block ? (a.block < b.block ? -1 : 1)
    : a.cumulative < b.cumulative ? -1 : a.cumulative > b.cumulative ? 1 : 0)
  let cumulative = baseline
  for (const c of ordered) {
    cumulative += c.amount
    if (c.amount < 0n || c.block < windows[0]!.startBlock || c.block > windows.at(-1)!.endBlock
      || c.cumulative !== cumulative) invalid(message)
  }
  cumulative = baseline
  return windows.map((window) => {
    const inPeriod = ordered.filter((c) => c.block >= window.startBlock && c.block <= window.endBlock)
    const claimed = inPeriod.reduce((sum, c) => sum + c.amount, 0n)
    cumulative += claimed
    return { ...window, claims: inPeriod.length, claimed, subgraph: cumulative }
  })
}

/** CLI/MCP expose mismatches; the web refuses numeric history when any comparison fails. */
export function compareRewardPeriodEnds(
  rows: readonly { readonly subgraph: bigint }[], chain: readonly bigint[],
): { subgraph: bigint; chain: bigint; match: boolean }[] {
  if (rows.length !== chain.length) invalid("incomplete or inconsistent reward claims")
  return rows.map((row, i) => ({ subgraph: row.subgraph, chain: chain[i]!, match: row.subgraph === chain[i] }))
}
