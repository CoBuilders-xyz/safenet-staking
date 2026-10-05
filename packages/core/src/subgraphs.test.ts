import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_GRAPH_NODE_PORT,
  SUBGRAPH_ENDPOINTS,
  SUBGRAPH_NAMES,
  SUBGRAPH_STALE_AFTER_SECONDS,
  isLocalSubgraphUrl,
  localSubgraphUrl,
  subgraphEndpoints,
} from "./subgraphs.js"
import { GNOSIS_SNAPSHOT } from "./gnosis-snapshot.js"

test("the default endpoints are the local graph-node on its default port", () => {
  assert.equal(SUBGRAPH_ENDPOINTS.mainnet, `http://127.0.0.1:${DEFAULT_GRAPH_NODE_PORT}/subgraphs/name/safenet/mainnet`)
  assert.equal(SUBGRAPH_ENDPOINTS.gnosis, `http://127.0.0.1:${DEFAULT_GRAPH_NODE_PORT}/subgraphs/name/safenet/gnosis`)
})

test("the port moves the local endpoint, for a worktree with its own graph-node", () => {
  assert.equal(localSubgraphUrl("gnosis", 8160), "http://127.0.0.1:8160/subgraphs/name/safenet/gnosis")
  assert.deepEqual(subgraphEndpoints({ graphNodePort: "8160" }), {
    mainnet: "http://127.0.0.1:8160/subgraphs/name/safenet/mainnet",
    gnosis: "http://127.0.0.1:8160/subgraphs/name/safenet/gnosis",
  })
})

test("an override replaces one chain only, and an empty override counts as unset", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-mainnet/version/latest"
  assert.deepEqual(subgraphEndpoints({ overrides: { mainnet: studio, gnosis: "" } }), {
    mainnet: studio,
    gnosis: SUBGRAPH_ENDPOINTS.gnosis,
  })
})

test("a build that disallows local endpoints gets none while the defaults are local", () => {
  assert.deepEqual(subgraphEndpoints({ allowLocal: false }), { mainnet: undefined, gnosis: undefined })
  const studio = "https://api.studio.thegraph.test/query/1/safenet-gnosis/version/latest"
  assert.deepEqual(subgraphEndpoints({ allowLocal: false, overrides: { gnosis: studio } }), { mainnet: undefined, gnosis: studio })
})

test("local URLs are recognised on any port, deployed ones are not", () => {
  assert.equal(isLocalSubgraphUrl(localSubgraphUrl("mainnet", 8160)), true)
  assert.equal(isLocalSubgraphUrl("http://localhost:8000/subgraphs/name/safenet/mainnet"), true)
  assert.equal(isLocalSubgraphUrl("https://api.studio.thegraph.test/query/1/safenet-mainnet/version/latest"), false)
})

test("every chain has a subgraph name", () => {
  assert.deepEqual(Object.keys(SUBGRAPH_NAMES).sort(), ["gnosis", "mainnet"])
})

test("the staleness threshold is a positive number of seconds", () => {
  assert.ok(Number.isInteger(SUBGRAPH_STALE_AFTER_SECONDS) && SUBGRAPH_STALE_AFTER_SECONDS > 0)
})

test("the Gnosis snapshot carries its run date and a consistent window", () => {
  assert.ok(!Number.isNaN(Date.parse(GNOSIS_SNAPSHOT.runAt)))
  const [low, high] = GNOSIS_SNAPSHOT.attestationsPerDayRange
  assert.ok(low <= GNOSIS_SNAPSHOT.attestationsPerDay && GNOSIS_SNAPSHOT.attestationsPerDay <= high)
  assert.ok(GNOSIS_SNAPSHOT.ceremonies.attestations <= GNOSIS_SNAPSHOT.ceremonies.all)
  for (const p of GNOSIS_SNAPSHOT.participation) {
    assert.match(p.address, /^0x[0-9a-fA-F]{40}$/)
    assert.ok(p.rate >= 0 && p.rate <= 1)
  }
})
