import { CHAINS } from "@cobuilders/safenet-core"
import type { ConsensusWindowQuery } from "@/graphql/gnosis/generated"

const DAY_SECONDS = 86_400

/** Participation and attestations are reported over this many complete UTC days, like the snapshot. */
export const CONSENSUS_WINDOW_DAYS = 14

/** graph-node caps `first` at 1000. A page that reaches it may be truncated. */
const PAGE_LIMIT = 1000

/** Gnosis's nominal block time. The measured one runs about 2% slower; latency in seconds is approximate. */
export const GNOSIS_BLOCK_SECONDS = (CHAINS.gnosis.blockTime ?? 5_000) / 1000

/** Unix seconds of the UTC midnight at or before `ms`. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / 1000 / DAY_SECONDS) * DAY_SECONDS
}

/** The `since` for the window query: one day more than the window, so the first day can be dropped. */
export function consensusWindowSince(nowMs: number): number {
  return utcDayStart(nowMs) - (CONSENSUS_WINDOW_DAYS + 1) * DAY_SECONDS
}

/**
 * The value at quantile `p` of a histogram, where `buckets[n]` counts samples equal to n. The
 * same rule as `pnpm metrics`: sorted[min(count - 1, floor(count * p))]. Undefined with no samples.
 */
export function histogramQuantile(buckets: readonly bigint[], p: number): number | undefined {
  const count = buckets.reduce((sum, b) => sum + b, 0n)
  if (count === 0n) return undefined
  const n = Number(count)
  const target = BigInt(Math.min(n - 1, Math.floor(n * p)))
  let seen = 0n
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i]
    if (seen > target) return i
  }
  return buckets.length - 1
}

export interface ValidatorParticipation {
  /** Attended as a fraction of attestation ceremonies in the window. */
  rate: number
  attended: bigint
  absences: bigint
}

export interface ConsensusWindow {
  /** Complete UTC days counted. At most CONSENSUS_WINDOW_DAYS. */
  days: number
  /** Unix seconds of the first and last day counted. */
  from: number
  to: number
  attestationsPerDay: { mean: number; min: number; max: number }
  /** Undefined when no attestation in the window could be matched to its proposal. */
  latencyMedianBlocks: number | undefined
  ceremonies: bigint
  /** Keyed by lowercase validator address. Undefined when the page limit may have cut rows off. */
  participation: Map<string, ValidatorParticipation> | undefined
}

/**
 * The window figures from one ConsensusWindow answer.
 *
 * Only complete UTC days count: not today, which is still running, and not the first day the
 * subgraph indexed, which it entered part way through. Undefined when no complete day remains,
 * as on a subgraph deployed less than two days ago.
 */
export function deriveConsensusWindow(data: ConsensusWindowQuery, checkedAt: number): ConsensusWindow | undefined {
  const today = utcDayStart(checkedAt)
  const firstIndexed = data.firstDay[0]?.date
  const complete = data.consensusDays
    .filter((d) => d.date < today && (firstIndexed === undefined || d.date > firstIndexed))
    .sort((a, b) => a.date - b.date)
    .slice(-CONSENSUS_WINDOW_DAYS)
  if (complete.length === 0) return undefined

  const counted = new Set(complete.map((d) => d.date))
  const perDay = complete.map((d) => Number(d.attestations))
  const ceremonies = complete.reduce((sum, d) => sum + BigInt(d.attestationCeremonies), 0n)

  const buckets: bigint[] = []
  for (const d of complete) {
    d.latencyBuckets.forEach((v, i) => {
      buckets[i] = (buckets[i] ?? 0n) + BigInt(v)
    })
  }

  let participation: Map<string, ValidatorParticipation> | undefined
  if (data.validatorDays.length < PAGE_LIMIT && ceremonies > 0n) {
    const attended = new Map<string, bigint>()
    for (const v of data.validatorDays) {
      if (!counted.has(v.date)) continue
      const id = v.validator.id.toLowerCase()
      attended.set(id, (attended.get(id) ?? 0n) + BigInt(v.attended))
    }
    participation = new Map(
      [...attended].map(([id, a]) => [
        id,
        { rate: Number((a * 1_000_000_000n) / ceremonies) / 1_000_000_000, attended: a, absences: ceremonies - a },
      ]),
    )
  }

  return {
    days: complete.length,
    from: complete[0].date,
    to: complete[complete.length - 1].date,
    attestationsPerDay: {
      mean: Math.round(perDay.reduce((a, b) => a + b, 0) / perDay.length),
      min: Math.min(...perDay),
      max: Math.max(...perDay),
    },
    latencyMedianBlocks: histogramQuantile(buckets, 0.5),
    ceremonies,
    participation,
  }
}
