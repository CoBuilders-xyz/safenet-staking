import { afterEach, expect, it, vi } from "vitest"
import { SUBGRAPH_ENDPOINTS } from "@cobuilders/safenet-core"

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it("uses the browser gateway key and preserves explicit per-chain overrides", async () => {
  vi.stubEnv("VITE_GRAPH_API_KEY", "test-only-key")
  vi.stubEnv("VITE_SUBGRAPH_URL_MAINNET", "https://override.test/query")
  vi.stubEnv("VITE_SUBGRAPH_URL_GNOSIS", "")
  const { SUBGRAPH_URLS } = await import("../subgraphs")
  expect(SUBGRAPH_URLS.mainnet).toBe("https://override.test/query")
  expect(SUBGRAPH_URLS.gnosis).toBe("https://gateway.thegraph.com/api/test-only-key/subgraphs/id/9ZnBWftc6QB4tLn2CeYKTCqZkUrwjUNtH4DXvXHahG8q")
})
it("uses new Studio defaults without a browser key", async () => {
  vi.stubEnv("VITE_GRAPH_API_KEY", "")
  vi.stubEnv("VITE_SUBGRAPH_URL_MAINNET", "")
  vi.stubEnv("VITE_SUBGRAPH_URL_GNOSIS", "")
  const { SUBGRAPH_URLS } = await import("../subgraphs")
  expect(SUBGRAPH_URLS).toEqual(SUBGRAPH_ENDPOINTS)
})
