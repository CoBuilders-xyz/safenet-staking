import { test } from "node:test"
import assert from "node:assert/strict"
import { fakeContext, STAKER } from "../../cli/src/test-support.js"
import { readConfig } from "./config.js"
import { library } from "./library.js"
import { connect, fakeLibrary, textOf } from "./test-support.js"

test("empty indexed periods remain unavailable in MCP text and structured content", async () => {
  const fake = fakeLibrary({ ...library, createContext: () => fakeContext({ subgraph: "empty" }) })
  const s = await connect(readConfig({}), { fake })
  try {
    const result = await s.call("rewards_history", { address: STAKER })
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent?.periods, null)
    assert.equal(result.structuredContent?.count, 2)
    assert.equal(result.structuredContent?.sumMatchesChain, true)
    assert.match(textOf(result), /No periods: .*no reward periods/)
    assert.doesNotMatch(textOf(result), /each matches cumulativeClaimed/)
  } finally {
    await s.close()
  }
})

test("incomplete period history stays unavailable in MCP text and structured content", async () => {
  for (const subgraph of ["missing-claim", "missing-period", "missing-last-period", "duplicate-period"] as const) {
    const fake = fakeLibrary({ ...library, createContext: () => fakeContext({ subgraph }) })
    const s = await connect(readConfig({}), { fake })
    try {
      const result = await s.call("rewards_history", { address: STAKER, all: true })
      assert.equal(result.isError, undefined)
      assert.equal(result.structuredContent?.periods, null, subgraph)
      assert.equal(result.structuredContent?.count, 2)
      assert.equal(result.structuredContent?.totalClaimed, String(10n * 10n ** 18n))
      assert.equal(result.structuredContent?.sumMatchesChain, true)
      assert.match(textOf(result), /No periods: .*incomplete or inconsistent/)
      assert.doesNotMatch(textOf(result), /each matches cumulativeClaimed/)
    } finally { await s.close() }
  }
})

test("same-block root updates keep MCP periods unavailable and chain claims visible", async () => {
  const fake = fakeLibrary({ ...library, createContext: () => fakeContext({ subgraph: "same-block-periods" }) })
  const s = await connect(readConfig({}), { fake })
  try {
    const result = await s.call("rewards_history", { address: STAKER })
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent?.periods, null)
    assert.equal(result.structuredContent?.count, 2)
    assert.equal(result.structuredContent?.sumMatchesChain, true)
    assert.match(textOf(result), /No periods: .*inconsistent reward period boundaries/)
    assert.doesNotMatch(textOf(result), /each matches cumulativeClaimed/)
  } finally { await s.close() }
})

test("real reward history preserves claims and redacts invalid subgraph settings in every MCP result field", async () => {
  for (const url of ["not-a-url-private-marker", "https://user:private-marker@[broken/query", "ftp://subgraph.invalid/private-marker"]) {
    let fetches = 0
    const fake = fakeLibrary({
      ...library,
      createContext: (options) => ({
        ...fakeContext(),
        subgraphUrl: options?.subgraphUrl,
        fetch: (...args) => { fetches++; return globalThis.fetch(...args) },
      }),
    })
    const s = await connect(readConfig({ SUBGRAPH_URL_MAINNET: url }), { fake })
    try {
      const result = await s.call("rewards_history", { address: STAKER })
      assert.equal(result.isError, undefined)
      assert.equal(fetches, 0)
      assert.doesNotMatch(JSON.stringify(result) + s.logs.join("\n"), /private-marker|subgraph\.invalid/)
      assert.match(textOf(result), /SUBGRAPH_URL_MAINNET must be an HTTP or HTTPS URL/)
      assert.equal(result.structuredContent?.periods, null)
      assert.equal(result.structuredContent?.count, 2)
      assert.equal(result.structuredContent?.sumMatchesChain, true)
    } finally {
      await s.close()
    }
  }
})


test("GraphQL provider errors remain fixed and private in all MCP content", async () => {
  const fake = fakeLibrary({ ...library, createContext: () => fakeContext({ subgraph: "graphql-error" }) })
  const s = await connect(readConfig({}), { fake })
  try {
    const result = await s.call("rewards_history", { address: STAKER })
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent?.periods, null)
    assert.equal(result.structuredContent?.count, 2)
    assert.match(textOf(result), /the subgraph answered with an error/)
    assert.doesNotMatch(JSON.stringify(result), /private-provider-marker/)
  } finally { await s.close() }
})

test("MCP reward history falls back to Studio and surfaces double failure", async () => {
  for (const bothFail of [false, true]) {
    const fake = fakeLibrary({ ...library, createContext: (options) => ({
      ...fakeContext(bothFail ? { subgraph: "down" } : {}), subgraphUrl: options?.subgraphUrl,
    }) })
    const s = await connect(readConfig({ GRAPH_API_KEY: "test-only-private-marker" }), { fake })
    try {
      const result = await s.call("rewards_history", { address: STAKER })
      if (bothFail) {
        assert.equal(result.structuredContent?.periods, null)
        assert.match(textOf(result), /gateway and Studio fallback both failed/)
      } else {
        assert.notEqual(result.structuredContent?.periods, null)
        assert.match(textOf(result), /each matches cumulativeClaimed/)
      }
      assert.doesNotMatch(JSON.stringify(result) + s.logs.join("\n"), /test-only-private-marker/)
    } finally { await s.close() }
  }
})

test("unavailable indexed history and refused RPC scans return isError without empty structured results", async () => {
  const fake = fakeLibrary({ ...library, createContext: () => fakeContext({ subgraph: "down", logsRefused: true }) })
  const s = await connect(readConfig({}), { fake })
  try {
    for (const [name, args] of [["rewards_history", { address: STAKER }], ["withdrawals_list", {}]] as const) {
      const result = await s.call(name, args)
      assert.equal(result.isError, true)
      assert.equal(result.structuredContent, undefined)
      assert.match(textOf(result), /History unavailable.*No partial results returned/)
      assert.doesNotMatch(textOf(result), /https?:|private-provider-marker/)
    }
  } finally { await s.close() }
})

test("MCP distinguishes historical RPC state denial from successful subgraph reads", async () => {
  const { HttpRequestError } = await import("viem")
  const fake = fakeLibrary({ ...library, createContext: () => fakeContext({
    historicalStateError: new HttpRequestError({ url: "https://rpc.invalid/private-marker", status: 403 }),
  }) })
  const s = await connect(readConfig({}), { fake })
  try {
    const result = await s.call("rewards_history", { address: STAKER })
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent?.periods, null)
    assert.equal(result.structuredContent?.count, 2)
    assert.equal(result.structuredContent?.sumMatchesChain, true)
    assert.match(textOf(result), /the RPC could not verify reward period 1: historical eth_call/)
    assert.match(textOf(result), /HTTP 403/)
    assert.doesNotMatch(JSON.stringify(result), /private-marker|subgraph could not give/)
  } finally { await s.close() }
})
