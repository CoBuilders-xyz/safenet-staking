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
