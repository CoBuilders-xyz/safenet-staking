import { test } from "node:test"
import assert from "node:assert/strict"
import { getAddress } from "viem"
import { INDEXED_EVENTS } from "./abis.js"
import { CONTRACTS, GNOSIS_CONTRACTS, type ContractName, type ContractRef } from "./contracts.js"

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

test("every Gnosis contract names the programme it belongs to", () => {
  // verify:abis reads `programme` and, once PROGRAMME_CLOSED_FROM closes it, scans the contract
  // back from that programme's end. A Gnosis contract with none would be scanned from the head
  // for ever, and fail once its programme ended.
  for (const [name, ref] of refs) {
    if (ref.chain !== "gnosis") continue
    assert.notEqual(ref.programme, undefined, name)
  }
})

test("a contract with a programme can be searched for that programme's end", () => {
  // verify:abis searches a closed programme's last block from the deploy block or the scan floor.
  for (const [name, ref] of refs) {
    if (ref.programme === undefined) continue
    assert.notEqual(ref.deployBlock ?? ref.startBlock, undefined, name)
  }
})

test("each programme's Gnosis roles name Gnosis contracts of that programme", () => {
  for (const [programme, roles] of Object.entries(GNOSIS_CONTRACTS)) {
    for (const [role, name] of Object.entries(roles)) {
      const ref: ContractRef = CONTRACTS[name as ContractName]
      assert.equal(ref.chain, "gnosis", `${programme}.${role}`)
      assert.equal(ref.programme, programme, `${programme}.${role}`)
      assert.notEqual(ref.deployBlock, undefined, `${programme}.${role}: an indexer starts at the deploy block`)
    }
  }
})

test("every Gnosis contract plays a role in its programme", () => {
  // A Gnosis contract outside GNOSIS_CONTRACTS is one nothing picks by programme, so the
  // subgraph and the parity run would never read it.
  const named = new Set(Object.values(GNOSIS_CONTRACTS).flatMap((roles) => Object.values(roles)))
  for (const [name, ref] of refs) if (ref.chain === "gnosis") assert.ok(named.has(name), name)
})
