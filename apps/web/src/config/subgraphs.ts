// Subgraph endpoints, per chain. The URLs and their local defaults come from
// @cobuilders/safenet-core; this decides which one this build uses.
//
//   VITE_SUBGRAPH_URL_MAINNET / VITE_SUBGRAPH_URL_GNOSIS   win when set
//   development, with neither set                          the local graph-node, on the port in .env.ports
//   a production build, with neither set                   no endpoint
//
// A production build does not fall back to 127.0.0.1: a deployed page would then ask every
// visitor's own machine for a subgraph. With no endpoint, the overview reads the contracts and
// says so.
import { subgraphEndpoints, type ChainKey } from "@cobuilders/safenet-core"

const nonEmpty = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined)

const overrides: Record<ChainKey, string | undefined> = {
  mainnet: nonEmpty(import.meta.env.VITE_SUBGRAPH_URL_MAINNET),
  gnosis: nonEmpty(import.meta.env.VITE_SUBGRAPH_URL_GNOSIS),
}

const local = subgraphEndpoints({ graphNodePort: nonEmpty(import.meta.env.VITE_GRAPH_NODE_PORT) })

export const SUBGRAPH_URLS: Record<ChainKey, string | undefined> = {
  mainnet: overrides.mainnet ?? (import.meta.env.DEV ? local.mainnet : undefined),
  gnosis: overrides.gnosis ?? (import.meta.env.DEV ? local.gnosis : undefined),
}
