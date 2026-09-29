// Addresses come from @cobuilders/safenet-core. D-005: this repository writes a hex
// address in exactly one place, so a redeploy is one edit and `pnpm verify:abis`
// covers what the interface uses as well as what the indexer does.
//
// Env vars still override, which is what the e2e suite relies on to point the app at
// mock contracts. The difference from the reference is the default: an unconfigured
// build now targets Mainnet with a real MerkleDrop and a real scan floor, instead of
// Sepolia with no rewards contract and fromBlock 0.
import type { Address } from "viem"
import { DEPLOYMENTS, isSupportedChain } from "@cobuilders/safenet-core"
import { activeChainId } from "@/config/chains"

type ContractAddresses = {
  staking: Address
  token: Address
  merkleDrop?: Address
  sanctionsOracle?: Address
}

const envOverride = (v: unknown): Address | undefined =>
  typeof v === "string" && v.length > 0 ? (v as Address) : undefined

export function getContractAddresses(chainId: number): ContractAddresses {
  if (!isSupportedChain(chainId)) {
    throw new Error(`No contract addresses for chain ${chainId}`)
  }
  const d = DEPLOYMENTS[chainId]
  return {
    staking: d.staking,
    token: d.token,
    merkleDrop: envOverride(import.meta.env.VITE_MERKLE_DROP_ADDRESS) ?? d.merkleDrop,
    sanctionsOracle: d.sanctionsOracle,
  }
}

/** Floor for historical log scans. Never 0: that asks a provider to scan from genesis. */
export const deployBlock: bigint = (() => {
  const override = import.meta.env.VITE_STAKING_DEPLOY_BLOCK
  if (override) return BigInt(override)
  return isSupportedChain(activeChainId) ? DEPLOYMENTS[activeChainId].scanFrom : 0n
})()
