/// <reference types="vite/client" />

interface Window {
  ethereum?: import("viem").EIP1193Provider
}

interface ImportMetaEnv {
  /** Public alert Worker origin. Never include credentials. */
  readonly VITE_ALERTS_API_URL?: string
  /** Query URL of the Mainnet subgraph. Public in the bundle by nature; never a URL with a key. */
  readonly VITE_SUBGRAPH_URL_MAINNET?: string
  /** Query URL of the Gnosis subgraph. Public in the bundle by nature; never a URL with a key. */
  readonly VITE_SUBGRAPH_URL_GNOSIS?: string
  /** Set by vite.config.ts from .env.ports. Empty when there is none. */
  readonly VITE_GRAPH_NODE_PORT?: string
}
