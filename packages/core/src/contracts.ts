/**
 * Contract addresses and deploy blocks.
 *
 * THIS FILE IS THE ONLY PLACE THESE VALUES ARE WRITTEN.
 * Never type a hex address anywhere else in this repository (D-005).
 *
 * Source: safe-fndn/safenet-beta-data/config/beta.env, cross-checked against
 * the Security page of SEF's documentation. Verified 2026-08-26.
 */
import type { Address } from "viem"
import type { ChainKey } from "./chains.js"

export interface ContractRef {
  readonly address: Address
  readonly chain: ChainKey
  /** Floor for historical scans. The deploy block where known, otherwise an earlier safe bound. */
  readonly startBlock?: bigint
}

export const CONTRACTS = {
  staking: {
    address: "0x115E78f160e1E3eF163B05C84562Fa16fA338509",
    chain: "mainnet",
    startBlock: 24_585_750n,
  },
  safeToken: {
    address: "0x5aFE3855358E112B5647B952709E6165e1c1eEEe",
    chain: "mainnet",
    // Scan floor for verify:abis, NOT the deploy block. The token deployed at 14,624,496.
    startBlock: 24_585_750n,
  },
  merkleDrop: {
    // Scan floor for verify:abis, NOT the deploy block. The contract deployed at 24,749,707.
    address: "0xe5139Fc0FB8eae81e30d8a85C22E88c6757120f2",
    chain: "mainnet",
    startBlock: 24_585_750n,
  },
  sanctionsList: {
    address: "0x40C57923924B5c5c5455c48D93317139ADDaC8fb",
    chain: "mainnet",
    startBlock: 14_356_508n,
  },
  delegateRegistry: {
    address: "0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446",
    chain: "mainnet",
    startBlock: 11_225_329n,
  },
  consensus: {
    address: "0x223624cBF099e5a8f8cD5aF22aFa424a1d1acEE9",
    chain: "gnosis",
    startBlock: 45_210_396n,
  },
  frostCoordinator: {
    // SEF publishes no start block for this one, and we asked on 2026-08-27. We then found it
    // ourselves: the coordinator deployed one block BEFORE the consensus contract. Verified by
    // scanning from this block and confirming the same 1,885 keygen groups.
    address: "0xaE27021CEB45316f1efe69D8E362aC07ED3Bd7E4",
    chain: "gnosis",
    startBlock: 45_210_395n,
  },
} as const satisfies Record<string, ContractRef>

export type ContractName = keyof typeof CONTRACTS

/** Where SEF publishes the data our numbers must match. */
export const SEF_DATA = {
  validatorInfo:
    "https://raw.githubusercontent.com/safe-fndn/safenet-beta-data/main/assets/validator-info.json",
  networkInfo:
    "https://raw.githubusercontent.com/safe-fndn/safenet-beta-data/main/assets/network-info.json",
  rewardsLatest:
    "https://raw.githubusercontent.com/safe-fndn/safenet-beta-data/main/assets/rewards/latest.json",
  rewardsProofBase:
    "https://raw.githubusercontent.com/safe-fndn/safenet-beta-data/main/assets/rewards",
  /** Their cron runs every 3 hours. Three missed runs is our staleness threshold (D-036). */
  staleAfterMs: 9 * 60 * 60 * 1000,
} as const
