// Exercise the Zod 3 consumers moved to the patched Zod 4 release by COB-660.
// Resolve through their real dependency chains so these tests use the installed overrides.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

function dependency(workspace, ...chain) {
  let require = createRequire(new URL(`../../${workspace}/package.json`, import.meta.url))
  let entry
  for (const name of chain) {
    entry = require.resolve(name)
    require = createRequire(entry)
  }
  return { entry, require }
}

const appkit = ["@walletconnect/ethereum-provider", "@reown/appkit"]

test("Reown wallet schemas accept valid events and reject malformed payloads after the Zod upgrade", async () => {
  const { entry } = dependency("apps/web", ...appkit, "@reown/appkit-wallet")
  const { W3mFrameSchema, W3mFrameConstants } = await import(pathToFileURL(entry).href)
  const event = {
    type: W3mFrameConstants.APP_SYNC_THEME,
    payload: { themeMode: "dark", themeVariables: { "--w3m-accent": "blue", "--w3m-z-index": 10 } },
  }
  assert.equal(W3mFrameSchema.appEvent.safeParse(event).success, true)
  assert.equal(W3mFrameSchema.appEvent.safeParse({ ...event, payload: { themeMode: "invalid" } }).success, false)
  assert.equal(W3mFrameSchema.appEvent.safeParse({ ...event, payload: { themeVariables: { bad: [] } } }).success, false)
})

test("Coinbase typed-data policies retain record validation after the Zod upgrade", () => {
  const { entry, require } = dependency("apps/web", ...appkit, "@reown/appkit-utils", "@base-org/account", "@coinbase/cdp-sdk")
  const { SignEvmTypedDataFieldCriterionSchema: schema } = require(join(dirname(entry), "policies/evmSchema.js"))
  const criterion = {
    type: "evmTypedDataField",
    types: { types: { Message: [{ name: "text", type: "string" }] }, primaryType: "Message" },
    conditions: [{ path: "text", match: "^hello$" }],
  }
  assert.equal(schema.safeParse(criterion).success, true)
  assert.equal(schema.safeParse({ ...criterion, types: { ...criterion.types, types: { Message: [{ name: 7 }] } } }).success, false)
  assert.equal(schema.safeParse({ ...criterion, conditions: [] }).success, false)
})

test("Graph tooling validates ABI arguments after the transitive Zod upgrade", () => {
  const { require } = dependency("packages/subgraph-mainnet", "@graphprotocol/graph-cli", "web3-eth-abi")
  const { encodeParameter } = require("web3-eth-abi")
  assert.match(encodeParameter("uint256", 42), /^0x0+2a$/)
  assert.throws(() => encodeParameter("uint256", -1))
  const { validator } = require("web3-validator")
  assert.doesNotThrow(() => validator.validate(["uint256"], [42]))
  assert.throws(() => validator.validate(["uint256"], [-1]))
})
