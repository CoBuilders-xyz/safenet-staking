import { http, fallback, type Chain } from "viem"
import { mainnet } from "wagmi/chains"
import { DEPLOYMENTS, DEFAULT_CHAIN_ID, isSupportedChain } from "@cobuilders/safenet-core"

// Mainnet only. The reference supports Sepolia as well; we removed it, because tests that
// need real contracts and real state are meant to run on an Anvil fork of Mainnet instead.
export const activeChainId = Number(import.meta.env.VITE_CHAIN_ID || DEFAULT_CHAIN_ID)

export const activeChain: Chain = mainnet

/**
 * Endpoints for the active chain, tried in order.
 *
 * Three variables, in this order: VITE_RPC_URL, then _FALLBACK_1, then _FALLBACK_2.
 *
 * The variables REPLACE the built-in list. They do not extend it. That matters for the
 * end-to-end suite: it sets VITE_RPC_URL to a mock and intercepts the calls. If a failing
 * mock fell through to a real endpoint, the tests would leave the machine and stop being
 * repeatable.
 *
 * With no variable set, the list comes from @cobuilders/safenet-core, where each entry
 * was called against the real contract and timed.
 *
 * Passing no endpoint at all is what broke this screen before: viem then uses its own
 * default, https://eth.merkle.io, which answers 429 and makes every read return zero.
 */
const fromEnv = [
  import.meta.env.VITE_RPC_URL,
  import.meta.env.VITE_RPC_URL_FALLBACK_1,
  import.meta.env.VITE_RPC_URL_FALLBACK_2,
].filter((u): u is string => typeof u === "string" && u.length > 0)

export const rpcEndpoints: readonly string[] =
  fromEnv.length > 0 ? fromEnv : isSupportedChain(activeChainId) ? DEPLOYMENTS[activeChainId].rpc : []

export const transports = {
  [activeChain.id]: fallback(
    rpcEndpoints.map((url) => http(url, { batch: { wait: 50 } })),
  ),
}
