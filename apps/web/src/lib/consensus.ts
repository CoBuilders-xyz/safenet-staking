import {
  BETA_END_DAY,
  CHAINS,
  GNOSIS_AEGIS_FIRST_COMPLETE_DAY,
  GNOSIS_INDEXED_PROGRAMME,
  programmePhase,
  utcDayMs,
  type Programme,
} from "@cobuilders/safenet-core"
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

/**
 * How many of the newest days the window query reads: the window, plus today and the first
 * indexed day of Beta, which are both partial and dropped.
 */
export const CONSENSUS_QUERY_DAYS = CONSENSUS_WINDOW_DAYS + 2

/** GraphQL's largest Int: no bound. */
const NO_BOUND = 2_147_483_647

/**
 * The window query's variables: the rows of one programme, and for Beta, which has ended, up to
 * its last day only.
 */
export function consensusQueryVariables(programme: Programme = GNOSIS_INDEXED_PROGRAMME) {
  return {
    days: CONSENSUS_QUERY_DAYS,
    until: programme === "beta" ? utcDayMs(BETA_END_DAY) / 1000 : NO_BOUND,
    programme,
  }
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
  /** Unix seconds of the last counted day with an attestation ceremony. Undefined when none has one. */
  lastCeremonyDay: number | undefined
  /** Keyed by lowercase validator address. Undefined when the page limit may have cut rows off. */
  participation: Map<string, ValidatorParticipation> | undefined
}

/**
 * The window figures from one ConsensusWindow answer: the CONSENSUS_WINDOW_DAYS calendar days
 * ending at the newest complete day the subgraph holds, which is yesterday while the network
 * attests. The days counted are consecutive; a fully indexed day with no row contributes zero.
 *
 * Only complete UTC days count. Today is still running. Beta's first stored day is conservatively
 * dropped because its index starts part way through history. Aegis is indexed from deployment:
 * use its verified coverage boundary, not its first attestation day. While reading Beta, only Beta
 * days count: a row dated after Beta ended is a stray ceremony on a closed contract, such as the
 * one on 6 October 2026. Undefined when no complete day remains, as on a subgraph deployed less
 * than two days ago.
 */
export function deriveConsensusWindow(
  data: ConsensusWindowQuery,
  checkedAt: number,
  programme: Programme = GNOSIS_INDEXED_PROGRAMME,
): ConsensusWindow | undefined {
  const today = utcDayStart(checkedAt)
  const firstIndexed = data.firstDay[0]?.date
  const firstComplete = programme === "aegis"
    ? utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000
    : firstIndexed === undefined ? undefined : firstIndexed + DAY_SECONDS
  const kept = data.consensusDays
    .filter((d) => d.date < today && (firstComplete === undefined || d.date >= firstComplete))
    .filter((d) => programme !== "beta" || programmePhase(new Date(d.date * 1000)) === "beta")
    .sort((a, b) => a.date - b.date)
  if (kept.length === 0) return undefined
  const last = kept[kept.length - 1].date
  const first = Math.max(
    last - (CONSENSUS_WINDOW_DAYS - 1) * DAY_SECONDS,
    firstComplete ?? kept[0].date,
  )
  const byDate = new Map(kept.map((d) => [d.date, d]))
  const complete = Array.from({ length: (last - first) / DAY_SECONDS + 1 }, (_, i) => {
    const date = first + i * DAY_SECONDS
    return byDate.get(date) ?? { date, attestations: "0", attestationCeremonies: "0", latencyBuckets: [] }
  })

  const counted = new Set(complete.map((d) => d.date))
  const perDay = complete.map((d) => Number(d.attestations))
  const ceremonies = complete.reduce((sum, d) => sum + BigInt(d.attestationCeremonies), 0n)

  const buckets: bigint[] = []
  for (const d of complete) {
    d.latencyBuckets.forEach((v, i) => {
      buckets[i] = (buckets[i] ?? 0n) + BigInt(v)
    })
  }

  // Rows come newest first. A full page holds every row of the window only when it reaches back
  // past the window's first day; otherwise the page limit may have cut some off.
  const oldestRow = Math.min(...data.validatorDays.map((v) => v.date))
  const allRows = data.validatorDays.length < PAGE_LIMIT || oldestRow < complete[0].date

  let participation: Map<string, ValidatorParticipation> | undefined
  const membership = data.programmeConsensus[0]
  const allMembers = membership && membership.validators.length < PAGE_LIMIT &&
    membership.validators.length === membership.validatorCount
  if (allRows && allMembers && ceremonies > 0n) {
    // Daily rows exist only after attendance. Membership retains validators that missed every ceremony.
    const attended = new Map(membership.validators.map((v) => [v.id.toLowerCase(), 0n]))
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
    lastCeremonyDay: complete.findLast((d) => BigInt(d.attestationCeremonies) > 0n)?.date,
    participation,
  }
}

/**
 * True while a set of Gnosis figures describes Beta, which has ended: while the subgraph indexes
 * only the Beta contracts, and after that while the last day the figures cover is before Aegis.
 * The second half is read from the data, so once the Aegis contracts are indexed the state goes
 * by itself when the index holds an Aegis day with a ceremony. `lastDay` is unix seconds,
 * undefined when the figures hold no ceremony at all.
 */
export function describesBeta(lastDay: number | undefined, programme: Programme = GNOSIS_INDEXED_PROGRAMME): boolean {
  if (programme === "beta") return true
  return lastDay === undefined || programmePhase(new Date(lastDay * 1000)) !== "aegis"
}
