import { test } from "node:test"
import assert from "node:assert/strict"
import { isAddress } from "viem"
import { CONTRACTS, type ContractName } from "./contracts.js"
import { DEFAULT_CHAIN_ID, DEPLOYMENTS, isSupportedChain, type Deployment } from "./deployments.js"

// Which CONTRACTS entry each address field of a Deployment derives from.
const ADDRESS_SOURCES = {
  staking: "staking",
  token: "safeToken",
  merkleDrop: "merkleDrop",
  sanctionsOracle: "sanctionsList",
} as const satisfies Partial<Record<keyof Deployment, ContractName>>

const mainnet = DEPLOYMENTS[1]

for (const [field, source] of Object.entries(ADDRESS_SOURCES)) {
  test(`DEPLOYMENTS[1].${field} is CONTRACTS.${source}.address`, () => {
    assert.equal(mainnet[field as keyof typeof ADDRESS_SOURCES], CONTRACTS[source].address)
    assert.equal(CONTRACTS[source].chain, "mainnet")
  })
}

test("every address field of DEPLOYMENTS[1] has a source in CONTRACTS", () => {
  const addressFields = Object.entries(mainnet)
    .filter(([, value]) => typeof value === "string" && isAddress(value))
    .map(([field]) => field)
    .sort()
  assert.deepEqual(addressFields, Object.keys(ADDRESS_SOURCES).sort())
})

test("DEPLOYMENTS[1].scanFrom is the staking start block, and never 0", () => {
  assert.equal(mainnet.scanFrom, CONTRACTS.staking.startBlock)
  assert.ok(mainnet.scanFrom > 0n)
})

test("DEPLOYMENTS[1].rpc lists public https endpoints only", () => {
  assert.ok(mainnet.rpc.length > 0)
  for (const url of mainnet.rpc) assert.equal(new URL(url).protocol, "https:")
})

test("the default chain is supported, and an unknown one is not", () => {
  assert.ok(isSupportedChain(DEFAULT_CHAIN_ID))
  assert.ok(!isSupportedChain(100))
})
