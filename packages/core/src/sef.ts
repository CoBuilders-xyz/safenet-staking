/**
 * The shape of the JSON SEF publishes at `safe-fndn/safenet-data`.
 *
 * These are not our types to choose. Each one was read off the live file on
 * 2026-10-22 and must be re-checked, not assumed, when `verify:abis` or
 * `test:parity` starts failing for a reason that is not a contract change. SEF removed
 * `updatedAt` from rewards/latest.json on 2026-10-21 and has published a null
 * `participation_rate_14d` for every validator since 2026-10-20.
 *
 * Their cron overwrites validator-info.json and network-info.json every three hours, so a
 * parity run pins those two to the commit that last wrote them. rewards/latest.json is written
 * by a separate fortnightly pull request, so it is read from `main`.
 */
import { SEF_DATA } from "./contracts.js"

/** `assets/validator-info.json` — a bare array, indexed by position, not an object. */
export interface SefValidator {
  address: string
  commission: number
  is_active: boolean
  label: string
  /**
   * A double. Our own computation reproduces this bit-for-bit on an aligned run. Null when SEF
   * publishes no rate. SEF's pull request that moved its data job to Aegis says the Beta job
   * writes null once Beta's last attestation leaves the window, and the Aegis job replaces it.
   */
  participation_rate_14d: number | null
}

/** `assets/network-info.json` */
export interface SefNetworkInfo {
  /**
   * Decimal string in SAFE, with the 18 decimals written out, such as "73352054.1339…929". It
   * is exact to the wei. Parse it with `parseSefAmount`: `Number()` rounds it.
   */
  total_staked_amount: string
  total_transactions_checked: number
}

/** `assets/rewards/latest.json` */
export interface SefRewardsLatest {
  epoch: number
  /** Must equal the root the CumulativeMerkleDrop reports on chain. */
  merkleRoot: string
  /** ISO 8601. */
  rewardsUntil: string
  /** Decimal string, in wei. */
  tokenTotal: string
  /** Decimal string, in wei. */
  unpaidAmount: string
}

/**
 * `assets/rewards/proofs/<radix>/<address>.json`, read off live files on 2026-10-04.
 * A 404 means SEF published no proof for the address: it never earned rewards.
 */
export interface SefRewardProof {
  /** Decimal string, in wei. Everything earned to date, claimed or not. */
  cumulativeAmount: string
  /** Must equal the CumulativeMerkleDrop root on chain, or the proof is stale. */
  merkleRoot: string
  proof: string[] | null
  /**
   * Decimal string, in wei: the part held until compliance checks pass. Seen as "0" and as
   * absent. A null is treated as absent.
   */
  kycAmount?: string | null
  /** `true` once the address passed the checks. A null is treated as absent. */
  kyc?: boolean | null
}

/**
 * The reward files, as paths relative to a rewards data base: the repository's
 * `assets/rewards` directory, or the root of SEF's IPFS dataset. Every reader builds its URLs
 * from these two, so the layout lives here alone.
 *
 * The repository's layout was read off the live files on 2026-10-04. The IPFS dataset's layout
 * is not published yet: these paths assume it repeats the repository's under its root, and
 * must be checked against the dataset when SEF populates the ENS name. See rewards-source.ts.
 */
export const REWARDS_LATEST_PATH = "latest.json"

/**
 * One address's reward proof, relative to a rewards data base. The path fans out on the first
 * four bytes of the lower-case address, two hex digits per directory.
 */
export function rewardProofPath(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an address: ${address}`)
  const lower = address.toLowerCase()
  const radix = lower.slice(2, 10).match(/../g)!.join("/")
  return `proofs/${radix}/${lower}.json`
}

/** Where a rewards data base publishes one address's reward proof. The repository by default. */
export function rewardProofUrl(address: string, base: string = SEF_DATA.rewardsProofBase): string {
  return `${base}/${rewardProofPath(address)}`
}

/** validator-info.json reports `participation_rate_14d` over this many days. */
export const PARTICIPATION_WINDOW_DAYS = 14

/**
 * How many Gnosis blocks before a participation window its shares are read from. A ceremony
 * attested at the window's first block counts shares emitted before it.
 *
 * Measured span from a ceremony's first winning share to its completion: over 2,148 ceremonies
 * on 2026-09-03, median 1 block, p99 4, max 10; over 70,510 in the 16 days to block 48,602,160,
 * median 1, p99 3, max 260, and one ceremony over the 200 used until then.
 */
export const SHARE_LOOKBACK_BLOCKS = 1_000n

/**
 * The window a published `participation_rate_14d` covers.
 *
 * SEF's cron computes a rolling window ending at the top of the hour it ran, so the end is
 * the publish time floored to the hour. That shape was confirmed by fitting our own
 * computation against their file across the hour; see scripts/metrics-poc.ts.
 */
export function participationWindow(publishedAt: Date): { start: Date; end: Date } {
  const hour = 3_600_000
  const end = Math.floor(publishedAt.getTime() / hour) * hour
  return { start: new Date(end - PARTICIPATION_WINDOW_DAYS * 24 * hour), end: new Date(end) }
}

/** SAFE has 18 decimals. */
const SAFE_DECIMALS = 18

/**
 * A decimal SAFE amount as SEF writes it, in wei, exactly. Refuses a value with more places
 * than SAFE has, because rounding it would hide a change in SEF's format.
 */
export function parseSefAmount(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount)
  if (!m) throw new Error(`not a decimal amount: ${JSON.stringify(amount)}`)
  const [, whole = "0", frac = ""] = m
  if (frac.length > SAFE_DECIMALS) {
    throw new Error(`${frac.length} decimal places, more than SAFE's ${SAFE_DECIMALS}: ${amount}`)
  }
  return BigInt(whole + frac.padEnd(SAFE_DECIMALS, "0"))
}

/** A UTC calendar day, written YYYY-MM-DD. */
export type UtcDay = `${number}-${number}-${number}`

/*
 * The programme calendar, from the Safe Ecosystem Foundation's transition note of 7 October 2026.
 * Beta ended on BETA_END_DAY and its final rewards distribution was scheduled for 8 October.
 * Aegis starts on AEGIS_START_DAY, when its rewards start accruing. The days between belong to
 * neither programme. On-chain, attestations on the Beta Consensus contract on Gnosis stopped on
 * BETA_END_DAY, with one stray ceremony on 6 October.
 */

/** The last UTC day of Safenet Beta. */
export const BETA_END_DAY: UtcDay = "2026-10-05"

/** The first UTC day of Aegis: rewards accrue from this day. */
export const AEGIS_START_DAY: UtcDay = "2026-10-13"

/** Aegis distributes rewards once per reward period of this many days. */
export const REWARD_PERIOD_DAYS = 14

/**
 * The participation a validator needs in a reward period. Below it, in SEF's words, "both the
 * validator and its delegators earn no rewards for that period". A fraction, like
 * `participation_rate_14d`.
 */
export const REWARD_PARTICIPATION_THRESHOLD = 0.75

export type ProgrammePhase = "beta" | "gap" | "aegis"

/** A programme, as opposed to the gap between two. */
export type Programme = Exclude<ProgrammePhase, "gap">

/**
 * The programme whose contracts packages/subgraph-gnosis indexes. Every ConsensusDay and
 * ValidatorDay row comes from these contracts, so a row dated outside the programme is a stray
 * on a closed contract, not a day of the network. The change that indexes the Aegis contracts
 * moves this.
 */
export const GNOSIS_INDEXED_PROGRAMME: Programme = "beta"

/**
 * The UTC day from which a programme is closed, for each programme that has ended. A programme
 * still running has no entry. verify:abis anchors its fast scan of a closed programme's
 * contracts at the last block before this day, because they will log none of its events again.
 * Beta closes on AEGIS_START_DAY rather than the day after BETA_END_DAY, so the stray ceremony of
 * 6 October stays inside it.
 */
export const PROGRAMME_CLOSED_FROM: Readonly<Partial<Record<Programme, UtcDay>>> = {
  beta: AEGIS_START_DAY,
}

const DAY_MS = 86_400_000

/** Milliseconds of a UTC day's midnight. */
export function utcDayMs(day: UtcDay): number {
  const ms = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(ms)) throw new Error(`not a UTC day: ${day}`)
  return ms
}

/**
 * The programme the UTC day containing `at` belongs to: Beta up to and including BETA_END_DAY,
 * Aegis from AEGIS_START_DAY, and the gap between.
 */
export function programmePhase(at: Date): ProgrammePhase {
  const day = Math.floor(at.getTime() / DAY_MS) * DAY_MS
  if (Number.isNaN(day)) throw new Error("not a date")
  if (day <= utcDayMs(BETA_END_DAY)) return "beta"
  if (day >= utcDayMs(AEGIS_START_DAY)) return "aegis"
  return "gap"
}
