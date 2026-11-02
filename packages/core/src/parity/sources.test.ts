import { test } from "node:test"
import assert from "node:assert/strict"
import { SUBGRAPH_ENDPOINTS, isLocalSubgraphUrl, localSubgraphUrl } from "../subgraphs.js"
import { reach, subgraphEndpoint, unreachable } from "./sources.js"

// Node's fetch on a refused connection: a bare "fetch failed", with the reason in `cause`.
const refused = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8000") })

test("an unreachable subgraph names the chain, the reason and the variable", () => {
  const e = unreachable("subgraph", "gnosis", refused)
  assert.match(e.message, /^could not reach the gnosis subgraph \(connect ECONNREFUSED 127\.0\.0\.1:8000\)/)
  assert.match(e.message, /check SUBGRAPH_URL_GNOSIS; when it is unset, the default in packages\/core is used/)
})

test("each endpoint family names its own variable", () => {
  assert.match(unreachable("github", "mainnet", refused).message, /the GitHub API .*GITHUB_TOKEN/)
  assert.match(unreachable("sef", "mainnet", refused).message, /SEF's files on raw\.githubusercontent\.com/)
  assert.match(unreachable("rpc", "mainnet", refused).message, /the mainnet RPC .*check MAINNET_RPC_URL/)
  assert.match(unreachable("rpc", "gnosis", refused).message, /check GNOSIS_RPC_URL/)
})

test("an RPC error keeps its first line and never its URL", () => {
  // The address is documentation space and the key is made up.
  const viem = { shortMessage: "HTTP request failed.\nURL: https://rpc.example.org/v2/k3y", message: "long" }
  const e = unreachable("rpc", "gnosis", viem)
  assert.match(e.message, /\(HTTP request failed\.\)/)
  assert.doesNotMatch(e.message, /k3y|example\.org/)
})

test("reach passes an answer through and turns a failure into the named error", async () => {
  assert.equal(await reach("rpc", "mainnet", async () => 7), 7)
  await assert.rejects(reach("subgraph", "mainnet", () => Promise.reject(refused)), /could not reach the mainnet subgraph/)
})

// subgraphEndpoint reads the environment, so each case sets it and puts it back.
function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return run()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test("the parity run reads SUBGRAPH_URL_<CHAIN> when it is set, for that chain only", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-gnosis/version/latest"
  withEnv({ SUBGRAPH_URL_MAINNET: undefined, SUBGRAPH_URL_GNOSIS: studio }, () => {
    assert.equal(subgraphEndpoint("gnosis"), studio)
    assert.equal(subgraphEndpoint("mainnet"), SUBGRAPH_ENDPOINTS.mainnet)
  })
})

test("with the variable unset or empty, the run reads the deployed default in core, never the local graph-node", () => {
  withEnv({ SUBGRAPH_URL_MAINNET: "", SUBGRAPH_URL_GNOSIS: undefined, GRAPH_NODE_PORT: "8160" }, () => {
    for (const chain of ["mainnet", "gnosis"] as const) {
      const got = subgraphEndpoint(chain)
      assert.equal(got, SUBGRAPH_ENDPOINTS[chain])
      assert.equal(isLocalSubgraphUrl(got), false)
    }
  })
})

test("a local URL in the variable points the run at that graph-node as written", () => {
  const local = localSubgraphUrl("mainnet", 8160)
  withEnv({ SUBGRAPH_URL_MAINNET: local }, () => assert.equal(subgraphEndpoint("mainnet"), local))
})

test("parity uses GRAPH_API_KEY unless a chain has a full URL override", () => {
  withEnv({ GRAPH_API_KEY: "test-only-key", SUBGRAPH_URL_MAINNET: "https://override.test/query", SUBGRAPH_URL_GNOSIS: undefined }, () => {
    assert.equal(subgraphEndpoint("mainnet"), "https://override.test/query")
    assert.equal(subgraphEndpoint("gnosis"), "https://gateway.thegraph.com/api/test-only-key/subgraphs/id/9ZnBWftc6QB4tLn2CeYKTCqZkUrwjUNtH4DXvXHahG8q")
  })
})
