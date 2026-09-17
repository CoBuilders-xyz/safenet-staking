/**
 * Chain configuration.
 *
 * This module is imported by the browser app as well as by Node scripts, so it reads no
 * environment. A browser bundle that read a private RPC URL would publish the key.
 *
 * Browser: import PUBLIC_RPC_URLS.
 * Node:    call rpcUrls(), which puts a private endpoint first when one is configured.
 */
import { mainnet, gnosis } from "viem/chains"

export const CHAINS = { mainnet, gnosis } as const
export type ChainKey = keyof typeof CHAINS

/** Safe to ship to a browser. Tried in order. */
export const PUBLIC_RPC_URLS: Record<ChainKey, readonly string[]> = {
  mainnet: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  gnosis: ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"],
}

/**
 * Node only. Reads environment, so never call this from browser code.
 * ALCHEMY_MAINNET_RPC_URL is the archive node the fork tests and deep scans need (D-033).
 */
export function rpcUrls(chain: ChainKey): readonly string[] {
  const env = typeof process === "undefined" ? undefined : process.env
  const priv =
    chain === "mainnet"
      ? [env?.ALCHEMY_MAINNET_RPC_URL, env?.MAINNET_RPC_URL]
      : [env?.GNOSIS_RPC_URL]
  return [...priv.filter((u): u is string => !!u), ...PUBLIC_RPC_URLS[chain]]
}

/** @deprecated Node-only alias kept so existing scripts keep working. */
export const RPC_URLS: Record<ChainKey, readonly string[]> = {
  get mainnet() { return rpcUrls("mainnet") },
  get gnosis() { return rpcUrls("gnosis") },
}

export const ARCHIVE_RPC_URL =
  typeof process === "undefined" ? undefined : process.env.ALCHEMY_MAINNET_RPC_URL
