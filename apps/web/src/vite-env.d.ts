/// <reference types="vite/client" />

interface Window {
  ethereum?: import("viem").EIP1193Provider
}

interface ImportMetaEnv {
  /** Public alert Worker origin. Never include credentials. */
  readonly VITE_ALERTS_API_URL?: string
  /** COB-566 public browser key; restrict subgraphs and spending. Inject at build time. */
  readonly VITE_GRAPH_API_KEY?: string
  /** Explicit Mainnet URL override. Public in the bundle. */
  readonly VITE_SUBGRAPH_URL_MAINNET?: string
  /** Explicit Gnosis URL override. Public in the bundle. */
  readonly VITE_SUBGRAPH_URL_GNOSIS?: string
  /** Set by vite.config.ts from .env.ports. Empty when there is none. */
  readonly VITE_GRAPH_NODE_PORT?: string
  /** The release tag, such as web-v20261119.0. Set only by the release build. */
  readonly VITE_RELEASE_VERSION?: string
  /** Set by vite.config.ts in a build: the full SHA of HEAD. Empty in a dev server. */
  readonly VITE_BUILD_COMMIT?: string
  /** Set by vite.config.ts in a build: the commit time of HEAD, ISO 8601 in UTC. */
  readonly VITE_BUILD_TIME?: string
}
