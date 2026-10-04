import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { PUBLIC_RPC_URLS, RPC_URLS, rpcUrls } from "./chains.js"
import { DEPLOYMENTS } from "./deployments.js"

// Not a real endpoint. Stands in for an archive URL with a key in it.
const PRIVATE = "https://archive.invalid/v2/not-a-real-key"
const VARS = ["MAINNET_RPC_URL", "GNOSIS_RPC_URL"] as const
const saved: Partial<Record<(typeof VARS)[number], string>> = {}

beforeEach(() => {
  for (const name of VARS) {
    const value = process.env[name]
    if (value !== undefined) saved[name] = value
    delete process.env[name]
  }
})

afterEach(() => {
  for (const name of VARS) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    delete saved[name]
  }
})

test("without a private endpoint, rpcUrls() is the public list", () => {
  assert.deepEqual(rpcUrls("mainnet"), PUBLIC_RPC_URLS.mainnet)
  assert.deepEqual(rpcUrls("gnosis"), PUBLIC_RPC_URLS.gnosis)
})

test("an empty variable counts as unset", () => {
  process.env.MAINNET_RPC_URL = ""
  assert.deepEqual(rpcUrls("mainnet"), PUBLIC_RPC_URLS.mainnet)
})

test("MAINNET_RPC_URL goes first for Mainnet only", () => {
  process.env.MAINNET_RPC_URL = PRIVATE
  assert.deepEqual(rpcUrls("mainnet"), [PRIVATE, ...PUBLIC_RPC_URLS.mainnet])
  assert.deepEqual(rpcUrls("gnosis"), PUBLIC_RPC_URLS.gnosis)
})

test("GNOSIS_RPC_URL goes first for Gnosis only", () => {
  process.env.GNOSIS_RPC_URL = PRIVATE
  assert.deepEqual(rpcUrls("gnosis"), [PRIVATE, ...PUBLIC_RPC_URLS.gnosis])
  assert.deepEqual(rpcUrls("mainnet"), PUBLIC_RPC_URLS.mainnet)
})

test("a private endpoint never reaches the lists a browser reads", () => {
  process.env.MAINNET_RPC_URL = PRIVATE
  process.env.GNOSIS_RPC_URL = PRIVATE
  rpcUrls("mainnet")
  rpcUrls("gnosis")
  for (const list of Object.values(PUBLIC_RPC_URLS)) assert.ok(!list.includes(PRIVATE))
  for (const deployment of Object.values(DEPLOYMENTS)) assert.ok(!deployment.rpc.includes(PRIVATE))
})

test("the deprecated RPC_URLS alias reads the environment like rpcUrls()", () => {
  process.env.MAINNET_RPC_URL = PRIVATE
  assert.deepEqual(RPC_URLS.mainnet, rpcUrls("mainnet"))
  assert.deepEqual(RPC_URLS.gnosis, rpcUrls("gnosis"))
})

test("every public endpoint is https", () => {
  for (const list of Object.values(PUBLIC_RPC_URLS)) {
    assert.ok(list.length > 0)
    for (const url of list) assert.equal(new URL(url).protocol, "https:")
  }
})
