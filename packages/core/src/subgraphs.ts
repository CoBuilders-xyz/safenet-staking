/**
 * Where the subgraphs are queried, and how old their answer may be.
 *
 * Both subgraphs are deployed to Subgraph Studio, and SUBGRAPH_ENDPOINTS names those deployments
 * as the default for each chain. Every consumer resolves through this file: the web app, the
 * parity runs and the live codegen check. The local graph-node that `pnpm graph:up` starts is
 * reached through the override each caller passes in, VITE_SUBGRAPH_URL_* in the web app and its
 * live codegen check, SUBGRAPH_URL_* in the parity runs, set to the URL localSubgraphUrl builds.
 *
 * Browser safe: reads no environment. The port and the overrides are passed in by the caller.
 */
import type { ChainKey } from "./chains.js"
import type { UtcDay } from "./sef.js"

/**
 * First complete UTC day covered by both Aegis data sources, indexed from their deploy blocks.
 * Verified via eth_getBlockByNumber on 2026-10-28: CONTRACTS.aegisConsensus.deployBlock has
 * timestamp 1791381115 (October 7, 13:51:55 UTC); aegisFrostCoordinator has 1791289120
 * (October 6, 12:18:40 UTC). The first daily attestation row arrives later and is not partial.
 */
export const GNOSIS_AEGIS_FIRST_COMPLETE_DAY: UtcDay = "2026-10-08"

/**
 * The name each subgraph package deploys under on a local graph-node. Read from the
 * `differential` scripts in packages/subgraph-mainnet and packages/subgraph-gnosis, which query
 * these paths.
 */
export const SUBGRAPH_NAMES: Record<ChainKey, string> = {
  mainnet: "safenet/mainnet",
  gnosis: "safenet/gnosis",
}

/** graph-node's own query port. scripts/setup.sh moves it per worktree, in .env.ports. */
export const DEFAULT_GRAPH_NODE_PORT = 8000

/** The query URL of a subgraph on a local graph-node. */
export function localSubgraphUrl(chain: ChainKey, port: number | string = DEFAULT_GRAPH_NODE_PORT): string {
  return `http://127.0.0.1:${port}/subgraphs/name/${SUBGRAPH_NAMES[chain]}`
}

/**
 * The default endpoint per chain: the Subgraph Studio deployment of each subgraph, under its slug
 * and the version label the deploy printed, the short git SHA it was built from. ONE LINE PER
 * CHAIN. This file is the only place that knows these URLs, and every consumer follows.
 *
 * A Studio deploy retires older version labels of its slug: Studio keeps only the newest
 * versions, and a retired label answers "Not found". So the change that deploys a new version
 * moves that chain's value here, in the same change.
 *
 * Studio's query URL is its development endpoint: rate-limited to about 3,000 queries a day per
 * subgraph, and not the production read path. A query URL is public by nature, so a default must
 * never carry an API key.
 *
 * A deployed default is used everywhere. A local default would be used only where the caller
 * allows it (development), and the tests in subgraphs.test.ts refuse one: a production build
 * disallows local endpoints and would then query no subgraph for that chain. So the values here
 * stay deployed, and the local graph-node is reached through the overrides.
 */
export const SUBGRAPH_ENDPOINTS: Record<ChainKey, string> = {
  mainnet: "https://api.studio.thegraph.com/query/1762768/safenet-mainnet/0abe5fb",
  gnosis: "https://api.studio.thegraph.com/query/1762768/safenet-gnosis/efeed7c",
}

/** True for a URL on this machine, whatever its port and path. */
export function isLocalSubgraphUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(url)
}

/**
 * Resolve the endpoint per chain, in this order:
 *
 *   an override, when set and not empty
 *   the default in SUBGRAPH_ENDPOINTS, when it is a deployed URL
 *   the default, when it is the local graph-node and `allowLocal` is true, moved to `graphNodePort`
 *   undefined: no endpoint
 *
 * A production browser build passes `allowLocal: false`, so it never sends visitors' browsers to
 * their own 127.0.0.1. An override must never carry an API key, for the same reason as a default.
 */
export function subgraphEndpoints(options: {
  graphNodePort?: number | string
  overrides?: Partial<Record<ChainKey, string | undefined>>
  allowLocal?: boolean
} = {}): Record<ChainKey, string | undefined> {
  const { graphNodePort, overrides, allowLocal = true } = options
  const pick = (chain: ChainKey): string | undefined => {
    const o = overrides?.[chain]
    if (o && o.length > 0) return o
    const d = SUBGRAPH_ENDPOINTS[chain]
    if (!isLocalSubgraphUrl(d)) return d
    return allowLocal ? localSubgraphUrl(chain, graphNodePort) : undefined
  }
  return { mainnet: pick("mainnet"), gnosis: pick("gnosis") }
}

/**
 * The age past which a subgraph answer is not shown as current, in seconds. Age is the time
 * since the timestamp of the last block the subgraph indexed, `_meta.block.timestamp`.
 *
 * graph-node advances `_meta.block` on every block, with or without events, so on a healthy
 * deployment the age stays within a few block times of the head: under a minute on both chains.
 * Fifteen minutes is 75 Mainnet blocks and about 180 Gnosis blocks. That absorbs a slow indexer
 * or a reorg, and still catches a subgraph that has stopped or is resyncing.
 */
export const SUBGRAPH_STALE_AFTER_SECONDS = 15 * 60
