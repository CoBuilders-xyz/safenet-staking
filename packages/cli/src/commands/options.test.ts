import { test } from "node:test"
import assert from "node:assert/strict"
import { getAddress } from "viem"
import { fakeAddress } from "../test-support.js"
import {
  addressSchema, globalSchema, historySchema, parseOptions, UsageError, validatorsListSchema, withdrawalsListSchema,
} from "./options.js"

// Forty letters, so flipping their case cannot land on another valid form.
const LOWER = fakeAddress(BigInt(`0x${"abcd".repeat(10)}`))
const CHECKSUMMED = getAddress(LOWER)

test("an address in lower case or with a valid checksum parses to its checksum form", () => {
  assert.equal(parseOptions(addressSchema, LOWER), CHECKSUMMED)
  assert.equal(parseOptions(addressSchema, CHECKSUMMED), CHECKSUMMED)
  assert.equal(parseOptions(addressSchema, `  ${LOWER}  `), CHECKSUMMED)
})

test("a short value or a wrong checksum is a usage error that names the value", () => {
  assert.throws(() => parseOptions(addressSchema, "0x12"), (e: unknown) =>
    e instanceof UsageError && e.message.includes('"0x12"'))
  // Flip the case of every letter: the result is mixed case with a broken checksum.
  const flipped = `0x${[...CHECKSUMMED.slice(2)].map((c) =>
    c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join("")}`
  assert.throws(() => parseOptions(addressSchema, flipped), UsageError)
})

test("validators list defaults to active validators sorted by stake", () => {
  assert.deepEqual(parseOptions(validatorsListSchema, {}), { filter: "active", sort: "stake" })
  assert.deepEqual(parseOptions(validatorsListSchema, { active: true }), { filter: "active", sort: "stake" })
  assert.deepEqual(
    parseOptions(validatorsListSchema, { all: true, sort: "participation" }),
    { filter: "all", sort: "participation" },
  )
})

test("--active with --all, or an unknown sort key, is a usage error", () => {
  assert.throws(() => parseOptions(validatorsListSchema, { active: true, all: true }), /cannot be used together/)
  assert.throws(() => parseOptions(validatorsListSchema, { sort: "name" }), /--sort takes "stake" or "participation", not "name"/)
})

test("withdrawals list takes an optional address", () => {
  assert.deepEqual(parseOptions(withdrawalsListSchema, {}), {})
  assert.deepEqual(parseOptions(withdrawalsListSchema, { address: LOWER }), { address: CHECKSUMMED })
  assert.throws(() => parseOptions(withdrawalsListSchema, { address: "nope" }), UsageError)
})

test("rewards history shows the newest 20 claims unless --all lifts the limit", () => {
  assert.deepEqual(parseOptions(historySchema, {}), { limit: 20 })
  assert.deepEqual(parseOptions(historySchema, { all: true }), { limit: null })
})

test("a bad --rpc-url is a usage error that does not repeat the value", () => {
  const value = "ftp://archive.invalid/not-a-real-key"
  assert.throws(() => parseOptions(globalSchema, { rpcUrl: value }), (e: unknown) =>
    e instanceof UsageError && !e.message.includes("not-a-real-key"))
  assert.equal(parseOptions(globalSchema, { rpcUrl: "https://archive.invalid/x" }).rpcUrl, "https://archive.invalid/x")
  assert.deepEqual(parseOptions(globalSchema, {}), { json: false, verbose: false })
})

test("--rpc-url takes any host, so a local Anvil fork works", () => {
  for (const url of ["http://127.0.0.1:8545", "http://localhost:8545", "http://[::1]:8545", "http://anvil:8545"]) {
    assert.equal(parseOptions(globalSchema, { rpcUrl: url }).rpcUrl, url)
  }
  for (const url of ["ftp://127.0.0.1:8545", "javascript:alert(1)", "localhost:8545"]) {
    assert.throws(() => parseOptions(globalSchema, { rpcUrl: url }), UsageError, url)
  }
})
