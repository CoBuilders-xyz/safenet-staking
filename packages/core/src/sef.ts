/**
 * The shape of the JSON SEF publishes at `safe-fndn/safenet-beta-data`.
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
  /** Decimal string, in wei. Parse it exactly. `Number()` rounds at 1e6. */
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
