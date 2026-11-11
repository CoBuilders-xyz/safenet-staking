import {
  AEGIS_START_DAY,
  AEGIS_STAKER_REWARDS_PER_YEAR,
  BETA_FINAL_REWARDS_TOKEN_TOTAL,
  REWARD_PERIOD_DAYS,
  REWARD_PERIODS_PER_YEAR,
  utcDayMs,
} from "@cobuilders/safenet-core"

/**
 * The estimated APR on the Network Overview. The whole method is here, in `estimateApr` and the
 * parameters in `APR_METHOD`, so changing how the estimate is made changes this file alone.
 *
 *   APR = staker rewards of the last reward period
 *         / average daily total SAFE staked over that period
 *         × 365 / period length in days
 *
 * - Simple annualization, no compounding: rewards are claimed and restaked by hand, and SEF's own
 *   "approximate reward rate" is simple too. Hence APR, not APY.
 * - Gross: before the validator's commission, which applies to delegated stake only and not
 *   below the self-stake minimum, so no single net figure is right for every position.
 * - Network-wide: every staked SAFE counts, including stake behind validators that earned
 *   nothing in the period.
 *
 * Staker rewards. SEF's rewards file is cumulative and the app has only the latest one, so the
 * last period's rewards are the Aegis staker rewards to date, `tokenTotal` minus
 * `sentinelTokenTotal` minus Beta's final `tokenTotal`, divided by the Aegis periods to date. That
 * mean equals the last period only while the pool is flat, as SEP 56 sets it: so the figure is
 * withheld unless the mean is within `budgetTolerancePpm` of SEP 56's allocation per period.
 * The same check catches a `sentinelTokenTotal` that turns out not to be cumulative.
 *
 * Stake. The Mainnet subgraph writes one row per UTC day with an event, carrying the total
 * staked at the end of that day. Each day of the period takes the latest row at or before it,
 * so a quiet day carries the previous total forward. This is a daily approximation of SEF's
 * time-weighted stake, not the exact figure.
 */

const DAY_MS = 86_400_000
const DAY_SECONDS = 86_400

export interface AprMethod {
  /** Unix milliseconds of the first day Aegis rewards accrue. */
  readonly programmeStartMs: number
  /** Days in one reward period. */
  readonly periodDays: number
  /** Days in the year the period rate is annualized to. */
  readonly daysPerYear: number
  /** Cumulative `tokenTotal`, in wei, before the programme's first period. */
  readonly baseline: bigint
  /** SEP 56's staker allocation for one period, in wei. */
  readonly expectedPerPeriod: bigint
  /** How far, in parts per million, the measured rewards may differ from `expectedPerPeriod`. */
  readonly budgetTolerancePpm: bigint
  /** How many days after the period ends the file still counts as current. */
  readonly staleAfterDays: number
}

export const APR_METHOD: AprMethod = {
  programmeStartMs: utcDayMs(AEGIS_START_DAY),
  periodDays: REWARD_PERIOD_DAYS,
  daysPerYear: 365,
  baseline: BETA_FINAL_REWARDS_TOKEN_TOTAL,
  expectedPerPeriod: AEGIS_STAKER_REWARDS_PER_YEAR / BigInt(REWARD_PERIODS_PER_YEAR),
  budgetTolerancePpm: 10_000n,
  // One period, then ten days for SEF to publish: its first Aegis file came eight days after the
  // period ended. Past that, a newer period should exist and this one no longer describes now.
  staleAfterDays: REWARD_PERIOD_DAYS + 10,
}

export interface AprInputs {
  /** SEF's rewards/latest.json. */
  readonly latest: { readonly tokenTotal: string; readonly sentinelTokenTotal?: string; readonly rewardsUntil: string }
  /** The Mainnet subgraph's daily rows, in any order: unix seconds of the UTC day, and wei. */
  readonly days: readonly { readonly date: number; readonly totalStaked: string }[]
  /** Unix seconds of the last block the subgraph indexed. */
  readonly indexedAt: number | undefined
  /** Unix milliseconds of now. */
  readonly now: number
}

/** Why no estimate is shown. Each has its own sentence on screen. */
export type AprUnavailable =
  | "invalidAmount"
  | "invalidPeriodEnd"
  | "periodInFuture"
  | "noPeriodYet"
  | "misalignedPeriod"
  | "stale"
  | "noSentinelTotal"
  | "noRewards"
  | "outsideBudget"
  | "notIndexed"
  | "noStakeBeforePeriod"
  | "noStake"

export type AprEstimate =
  | {
      readonly ok: true
      /** A fraction: 0.0739 is 7.39%. */
      readonly apr: number
      /** Unix seconds: the first day of the period, and the day after its last. */
      readonly periodStart: number
      readonly periodEnd: number
      /** Staker rewards for one period, in wei. */
      readonly rewards: bigint
      /** Average daily total staked over the period, in wei. */
      readonly averageStaked: bigint
    }
  | { readonly ok: false; readonly reason: AprUnavailable }

/** Fraction digits kept from the exact ratio before it becomes a float. */
const SCALE = 10n ** 12n

const WEI = /^\d+$/

/** Estimate the network APR from SEF's latest rewards file and the subgraph's daily stake. */
export function estimateApr(inputs: AprInputs, method: AprMethod = APR_METHOD): AprEstimate {
  const fail = (reason: AprUnavailable): AprEstimate => ({ ok: false, reason })
  const { latest, days, indexedAt, now } = inputs

  if (!WEI.test(latest.tokenTotal) || (latest.sentinelTokenTotal !== undefined && !WEI.test(latest.sentinelTokenTotal))) {
    return fail("invalidAmount")
  }

  const endMs = Date.parse(latest.rewardsUntil)
  if (!Number.isFinite(endMs) || endMs % DAY_MS !== 0) return fail("invalidPeriodEnd")
  if (endMs > now) return fail("periodInFuture")
  const periodMs = method.periodDays * DAY_MS
  const periods = (endMs - method.programmeStartMs) / periodMs
  if (periods < 1) return fail("noPeriodYet")
  if (!Number.isInteger(periods)) return fail("misalignedPeriod")
  if (now - endMs > method.staleAfterDays * DAY_MS) return fail("stale")

  if (latest.sentinelTokenTotal === undefined) return fail("noSentinelTotal")
  const stakerTotal = BigInt(latest.tokenTotal) - BigInt(latest.sentinelTokenTotal) - method.baseline
  if (stakerTotal <= 0n) return fail("noRewards")
  const expected = method.expectedPerPeriod * BigInt(periods)
  const gap = stakerTotal > expected ? stakerTotal - expected : expected - stakerTotal
  if (gap * 1_000_000n > expected * method.budgetTolerancePpm) return fail("outsideBudget")

  const periodStart = (endMs - periodMs) / 1000
  const periodEnd = endMs / 1000
  if (indexedAt === undefined || indexedAt < periodEnd) return fail("notIndexed")
  if (days.some((d) => !WEI.test(d.totalStaked) || !Number.isInteger(d.date))) return fail("invalidAmount")
  const rows = days.filter((d) => d.date < periodEnd).toSorted((a, b) => a.date - b.date)
  if (rows.length === 0 || rows[0]!.date > periodStart) return fail("noStakeBeforePeriod")

  let stakeDays = 0n
  let row = 0
  for (let day = periodStart; day < periodEnd; day += DAY_SECONDS) {
    while (row + 1 < rows.length && rows[row + 1]!.date <= day) row++
    stakeDays += BigInt(rows[row]!.totalStaked)
  }
  if (stakeDays === 0n) return fail("noStake")

  // rewards / (stakeDays / periodDays) × daysPerYear / periodDays = rewards × daysPerYear / stakeDays
  const n = BigInt(periods)
  const ratio = (stakerTotal * BigInt(method.daysPerYear) * SCALE) / (n * stakeDays)
  return {
    ok: true,
    apr: Number(ratio) / Number(SCALE),
    periodStart,
    periodEnd,
    rewards: stakerTotal / n,
    averageStaked: stakeDays / BigInt(method.periodDays),
  }
}
