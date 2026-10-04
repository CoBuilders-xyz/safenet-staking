/**
 * What the interface needs, keyed by chain id.
 *
 * Mainnet only. Sepolia was removed on 2026-09-29: tests that need real contracts are meant
 * to run on an Anvil fork of Mainnet, which gives real contracts and real state, and SEF deploys no
 * rewards contract on Sepolia, so the screens we build next could not run there anyway.
 *
 * Addresses derive from CONTRACTS rather than repeat it, so the two cannot drift.
 * contracts.ts stays the production source that verify:abis and the indexer read.
 */
import type { Address } from "viem"
import { CONTRACTS } from "./contracts.js"

export interface Deployment {
  readonly staking: Address
  readonly token: Address
  /** Absent where no rewards contract is deployed. Consumers must handle undefined. */
  readonly merkleDrop?: Address
  /** Absent where no Chainalysis oracle is deployed. Gates must fail closed. */
  readonly sanctionsOracle?: Address
  /**
   * Floor for `fromBlock` on historical log scans. Never 0: that asks a provider to
   * scan from genesis, and every provider we use rejects or throttles it.
   */
  readonly scanFrom: bigint
  /**
   * Endpoints for a browser, in order of preference.
   *
   * NEVER PUT A KEY HERE. This list ships inside a public IPFS build. Node scripts read
   * a private endpoint through rpcUrls() instead.
   */
  readonly rpc: readonly string[]
}

export type SupportedChainId = 1

export const DEPLOYMENTS: Record<SupportedChainId, Deployment> = {
  1: {
    staking: CONTRACTS.staking.address,
    token: CONTRACTS.safeToken.address,
    merkleDrop: CONTRACTS.merkleDrop.address,
    sanctionsOracle: CONTRACTS.sanctionsList.address,
    scanFrom: CONTRACTS.staking.startBlock,
    rpc: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.drpc.org",
      "https://1rpc.io/eth",
    ],
  },
}

export function isSupportedChain(id: number): id is SupportedChainId {
  return id in DEPLOYMENTS
}

/** Mainnet. Anything that does not deliberately choose a testnet uses this. */
export const DEFAULT_CHAIN_ID = 1 satisfies SupportedChainId
