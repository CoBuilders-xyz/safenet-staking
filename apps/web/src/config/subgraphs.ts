// Subgraph endpoints, per chain. The defaults and the resolution rule live in
// @cobuilders/safenet-core (SUBGRAPH_ENDPOINTS, subgraphEndpoints); this passes in what only
// the build knows.
//
//   VITE_SUBGRAPH_URL_MAINNET / VITE_SUBGRAPH_URL_GNOSIS   win when set
//   a deployed default in core                             used everywhere
//   the local graph-node default in core                   development only, on the port in .env.ports
//
// A production build never falls back to 127.0.0.1: a deployed page would then ask every
// visitor's own machine for a subgraph. With no endpoint, the overview reads the contracts and
// says so.
import { subgraphEndpoints, type ChainKey } from "@cobuilders/safenet-core"

const nonEmpty = (v: string | undefined): string | undefined => (v && v.length > 0 ? v : undefined)

export const SUBGRAPH_URLS: Record<ChainKey, string | undefined> = subgraphEndpoints({
  graphNodePort: nonEmpty(import.meta.env.VITE_GRAPH_NODE_PORT),
  overrides: {
    mainnet: nonEmpty(import.meta.env.VITE_SUBGRAPH_URL_MAINNET),
    gnosis: nonEmpty(import.meta.env.VITE_SUBGRAPH_URL_GNOSIS),
  },
  allowLocal: import.meta.env.DEV,
})
