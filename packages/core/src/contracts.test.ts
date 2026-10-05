import { test } from "node:test"
import assert from "node:assert/strict"
import { getAddress } from "viem"
import { INDEXED_EVENTS } from "./abis.js"
import { CONTRACTS, type ContractName, type ContractRef } from "./contracts.js"

const refs = Object.entries(CONTRACTS) as [ContractName, ContractRef][]

test("every contract verify:abis --deep scans has a start block", () => {
  // --deep scans each indexed event's contract from its startBlock, and throws without one.
  const scanned = new Set(INDEXED_EVENTS.map((ev) => ev.contract))
  for (const name of scanned) {
    const ref: ContractRef = CONTRACTS[name]
    assert.equal(typeof ref.startBlock, "bigint", `${name} has no startBlock`)
    assert.ok(ref.startBlock! > 0n, `${name}.startBlock is 0, a scan from genesis`)
  }
})

test("a deploy block never sits before the scan floor", () => {
  for (const [name, ref] of refs) {
    if (ref.deployBlock === undefined || ref.startBlock === undefined) continue
    assert.ok(ref.deployBlock >= ref.startBlock, `${name}: deployBlock before startBlock`)
  }
})

test("every address is in checksum form", () => {
  for (const [name, ref] of refs) assert.equal(ref.address, getAddress(ref.address), name)
})

test("no two contracts on one chain share an address", () => {
  const seen = new Set<string>()
  for (const [name, ref] of refs) {
    const key = `${ref.chain}:${ref.address.toLowerCase()}`
    assert.ok(!seen.has(key), `${name} repeats an address`)
    seen.add(key)
  }
})
