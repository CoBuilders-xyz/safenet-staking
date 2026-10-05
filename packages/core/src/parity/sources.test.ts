import { test } from "node:test"
import assert from "node:assert/strict"
import { reach, unreachable } from "./sources.js"

// Node's fetch on a refused connection: a bare "fetch failed", with the reason in `cause`.
const refused = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8000") })

test("an unreachable subgraph names the chain, the reason and the variable", () => {
  const e = unreachable("subgraph", "gnosis", refused)
  assert.match(e.message, /^could not reach the gnosis subgraph \(connect ECONNREFUSED 127\.0\.0\.1:8000\)/)
  assert.match(e.message, /check SUBGRAPH_URL_GNOSIS; when it is unset, the local graph-node on GRAPH_NODE_PORT/)
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
