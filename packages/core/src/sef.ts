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

// Not typed yet: the per-address proof at `assets/rewards/<address>.json`. Its shape has
// not been read in the session that wrote this file, and guessing it here would put a
// plausible wrong type in the one module that is supposed to be authoritative.
// Type it when the Rewards screen needs it, from the live file.
