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

// These tests hold whatever SUBGRAPH_ENDPOINTS says, so swapping one default for a deployed URL
// is a one-line change that keeps this suite green.
const CHAINS = ["mainnet", "gnosis"] as const
const isLocal = (c: (typeof CHAINS)[number]) => isLocalSubgraphUrl(SUBGRAPH_ENDPOINTS[c])

test("each default is the local graph-node on its default port, or a deployed https URL", () => {
  for (const c of CHAINS) {
    const d = SUBGRAPH_ENDPOINTS[c]
    if (isLocal(c)) assert.equal(d, localSubgraphUrl(c, DEFAULT_GRAPH_NODE_PORT))
    else assert.match(d, /^https:\/\//)
  }
})

test("the port moves a local default, for a worktree with its own graph-node, and leaves a deployed one", () => {
  const got = subgraphEndpoints({ graphNodePort: "8160" })
  for (const c of CHAINS) {
    assert.equal(got[c], isLocal(c) ? `http://127.0.0.1:8160/subgraphs/name/${SUBGRAPH_NAMES[c]}` : SUBGRAPH_ENDPOINTS[c])
  }
})

test("an override replaces one chain only, and an empty override counts as unset", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-mainnet/version/latest"
  const got = subgraphEndpoints({ overrides: { mainnet: studio, gnosis: "" } })
  assert.equal(got.mainnet, studio)
  assert.equal(got.gnosis, subgraphEndpoints().gnosis)
})

test("a build that disallows local endpoints gets no local default, but keeps overrides and deployed defaults", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-gnosis/version/latest"
  const got = subgraphEndpoints({ allowLocal: false, overrides: { gnosis: studio } })
  assert.equal(got.gnosis, studio)
  assert.equal(got.mainnet, isLocal("mainnet") ? undefined : SUBGRAPH_ENDPOINTS.mainnet)
})

test("local URLs are recognised on any port and host form, deployed ones are not", () => {
  assert.equal(isLocalSubgraphUrl(localSubgraphUrl("mainnet", 8160)), true)
  assert.equal(isLocalSubgraphUrl("http://localhost:8000/subgraphs/name/safenet/mainnet"), true)
  assert.equal(isLocalSubgraphUrl("http://0.0.0.0:8000/subgraphs/name/safenet/mainnet"), true)
  assert.equal(isLocalSubgraphUrl("http://[::1]:8000"), true)
  assert.equal(isLocalSubgraphUrl("http://127.0.0.1"), true)
  assert.equal(isLocalSubgraphUrl("http://127.0.0.10/x"), false)
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
