/**
 * The shape of the JSON SEF publishes at `safe-fndn/safenet-data`.
 *
 * These are not our types to choose. Each one was read off the live file on
 * 2026-09-17 and must be re-checked, not assumed, when `verify:abis` or
 * `test:parity` starts failing for a reason that is not a contract change.
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
  /** A double. Our own computation reproduces this bit-for-bit on an aligned run. */
  participation_rate_14d: number
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
  /** ISO 8601. */
  updatedAt: string
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
 * Where SEF publishes one address's reward proof. The path fans out on the first four bytes
 * of the lower-case address, two hex digits per directory.
 */
export function rewardProofUrl(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`not an address: ${address}`)
  const lower = address.toLowerCase()
  const radix = lower.slice(2, 10).match(/../g)!.join("/")
  return `${SEF_DATA.rewardsProofBase}/proofs/${radix}/${lower}.json`
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
