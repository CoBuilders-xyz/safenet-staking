/** Each row's stake as a fraction of the total, to six decimals. Zero everywhere when the total is zero. */
export function withShares<T extends { stake: bigint }>(rows: readonly T[]): (T & { share: number })[] {
  const total = rows.reduce((sum, r) => sum + r.stake, 0n)
  return rows.map((r) => ({ ...r, share: total === 0n ? 0 : Number((r.stake * 1_000_000n) / total) / 1_000_000 }))
}

/**
 * The Herfindahl–Hirschman index of a distribution: the sum of the squared percentage shares,
 * rounded. 10,000 when one validator holds everything, 10,000 / n for n equal validators. The
 * same formula `pnpm metrics` reports.
 */
export function hhi(rows: readonly { share: number }[]): number {
  return Math.round(rows.reduce((sum, r) => sum + (r.share * 100) ** 2, 0))
}

/** The one-line definition shown next to the index. Kept here so the screen and its tests agree. */
export const HHI_DEFINITION =
  "The sum of each validator's squared percentage share: 10,000 if one validator held all stake, 10,000 ÷ n for n equal validators."
