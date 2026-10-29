import { bindings, defineConfig } from "cf/config"
import { SUBGRAPH_ENDPOINTS } from "../../packages/core/src/subgraphs.ts"

export default defineConfig({
  worker: {
    name: "safenet-api",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-29",
    env: {
      SUBGRAPH_URL_MAINNET: bindings.text(SUBGRAPH_ENDPOINTS.mainnet),
      SUBGRAPH_URL_GNOSIS: bindings.text(SUBGRAPH_ENDPOINTS.gnosis),
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
})
