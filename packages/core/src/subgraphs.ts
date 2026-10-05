/**
 * Where the subgraphs are queried, and how old their answer may be.
 *
 * Neither subgraph is deployed to The Graph Studio yet. Until it is, the default for each chain
 * is the local graph-node that `pnpm graph:up` starts, under the name its package deploys to.
 * The real endpoint then replaces the default through configuration, not through code.
 *
 * Browser safe: reads no environment. The port and the overrides are passed in by the caller.
 */
import type { ChainKey } from "./chains.js"

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

/** The default endpoint per chain: the local graph-node on its default port. */
export const SUBGRAPH_ENDPOINTS: Record<ChainKey, string> = {
  mainnet: localSubgraphUrl("mainnet"),
  gnosis: localSubgraphUrl("gnosis"),
}

/**
 * Resolve the endpoint per chain. An override wins; an empty override counts as unset.
 *
 * A query URL is public by nature: whoever loads a page that queries it can read it. So an
 * override must never carry an API key. A gateway URL with a key in its path belongs behind a
 * proxy, not in a browser bundle.
 */
export function subgraphEndpoints(options: {
  graphNodePort?: number | string
  overrides?: Partial<Record<ChainKey, string | undefined>>
} = {}): Record<ChainKey, string> {
  const pick = (chain: ChainKey): string => {
    const o = options.overrides?.[chain]
    return o && o.length > 0 ? o : localSubgraphUrl(chain, options.graphNodePort)
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
