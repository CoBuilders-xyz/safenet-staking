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

// These tests do not pin the deployed URLs: moving a default to a new Studio version keeps this
// suite green. They do fail when a default is the local graph-node, because a production build
// disallows local endpoints and would then query no subgraph for that chain.
const CHAINS = ["mainnet", "gnosis"] as const

test("each default is a deployed https URL, never the local graph-node", () => {
  for (const c of CHAINS) {
    const d = SUBGRAPH_ENDPOINTS[c]
    assert.match(d, /^https:\/\//)
    assert.equal(isLocalSubgraphUrl(d), false)
  }
})

test("the port is for a local default only, so it leaves the deployed defaults as they are", () => {
  const got = subgraphEndpoints({ graphNodePort: "8160" })
  for (const c of CHAINS) assert.equal(got[c], SUBGRAPH_ENDPOINTS[c])
  assert.equal(localSubgraphUrl("mainnet", "8160"), `http://127.0.0.1:8160/subgraphs/name/${SUBGRAPH_NAMES.mainnet}`)
  assert.equal(localSubgraphUrl("gnosis"), `http://127.0.0.1:${DEFAULT_GRAPH_NODE_PORT}/subgraphs/name/${SUBGRAPH_NAMES.gnosis}`)
})

test("an override replaces one chain only, and an empty override counts as unset", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-mainnet/version/latest"
  const got = subgraphEndpoints({ overrides: { mainnet: studio, gnosis: "" } })
  assert.equal(got.mainnet, studio)
  assert.equal(got.gnosis, subgraphEndpoints().gnosis)
})

test("a build that disallows local endpoints keeps overrides and deployed defaults, so it always has an endpoint", () => {
  const studio = "https://api.studio.thegraph.test/query/1/safenet-gnosis/version/latest"
  const got = subgraphEndpoints({ allowLocal: false, overrides: { gnosis: studio } })
  assert.equal(got.gnosis, studio)
  assert.equal(got.mainnet, SUBGRAPH_ENDPOINTS.mainnet)
  for (const c of CHAINS) assert.notEqual(subgraphEndpoints({ allowLocal: false })[c], undefined)
})

test("a local override is used as written, so the local graph-node stays reachable", () => {
  const local = localSubgraphUrl("mainnet", "8160")
  assert.equal(subgraphEndpoints({ overrides: { mainnet: local } }).mainnet, local)
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

test("gateway key selects both Network IDs; explicit per-chain URLs still win", () => {
  const got = subgraphEndpoints({ graphApiKey: " test-only-key " })
  assert.equal(got.mainnet, "https://gateway.thegraph.com/api/test-only-key/subgraphs/id/K1gHS5P5vZU3LApqchuuQxkmZGDDAUavkQUdGDV7Vxs")
  assert.equal(got.gnosis, "https://gateway.thegraph.com/api/test-only-key/subgraphs/id/9ZnBWftc6QB4tLn2CeYKTCqZkUrwjUNtH4DXvXHahG8q")
  const override = "https://graph.test/mainnet"
  assert.deepEqual(subgraphEndpoints({ graphApiKey: "test-only-key", overrides: { mainnet: override, gnosis: "" } }), { mainnet: override, gnosis: got.gnosis })
  assert.deepEqual(subgraphEndpoints({ graphApiKey: "  " }), SUBGRAPH_ENDPOINTS)
})

test("key is encoded as a single path segment, and fallbacks use the current Studio account", () => {
  assert.ok(subgraphEndpoints({ graphApiKey: "test/key?#" }).mainnet?.includes("/test%2Fkey%3F%23/subgraphs/id/"))
  for (const chain of CHAINS) assert.equal(SUBGRAPH_ENDPOINTS[chain], `https://api.studio.thegraph.com/query/1763864/safenet-${chain}/e66567d`)
})

test("Network query success, recovery and double failure do not leak provider credentials", async () => {
  const { withSubgraphFallback } = await import("./subgraphs.js")
  for (const chain of CHAINS) {
    const gateway = subgraphEndpoints({ graphApiKey: "test-only-private-marker" })[chain]!
    const calls: string[] = []
    assert.equal(await withSubgraphFallback(gateway, async (url) => { calls.push(url); return "gateway" }), "gateway")
    assert.deepEqual(calls, [gateway])
    calls.length = 0
    assert.equal(await withSubgraphFallback(gateway, async (url) => {
      calls.push(url)
      if (url === gateway) throw new Error("402 private-marker")
      return "studio"
    }), "studio")
    assert.deepEqual(calls, [gateway, SUBGRAPH_ENDPOINTS[chain]])
    await assert.rejects(withSubgraphFallback(gateway, async () => { throw new Error("private-marker") }),
      (error: Error) => /gateway and Studio fallback both failed/.test(error.message) && !error.message.includes("private-marker"))
  }
})

test("custom overrides and cancelled queries never switch providers", async () => {
  const { withSubgraphFallback } = await import("./subgraphs.js")
  let calls = 0
  await assert.rejects(withSubgraphFallback("https://custom.test/query", async () => { calls++; throw new Error("custom failure") }), /custom failure/)
  assert.equal(calls, 1)
  const controller = new AbortController()
  await assert.rejects(withSubgraphFallback(subgraphEndpoints({ graphApiKey: "test" }).mainnet!, async () => {
    calls++; controller.abort(); throw new Error("cancelled")
  }, controller.signal))
  assert.equal(calls, 2)
})
