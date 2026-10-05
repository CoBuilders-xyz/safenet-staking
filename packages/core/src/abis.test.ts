import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAbiItem, toEventSelector, type AbiEvent } from "viem"
import { INDEXED_EVENTS } from "./abis.js"
import { CONTRACTS } from "./contracts.js"

// These prove the registry is well formed. Whether the chain still emits each signature is
// what verify:abis proves; no test here touches the network.

test("every indexed event parses as an event whose name matches its signature", () => {
  for (const ev of INDEXED_EVENTS) {
    const item = parseAbiItem(ev.signature) as AbiEvent
    assert.equal(item.type, "event", ev.signature)
    assert.ok(ev.signature.startsWith(`event ${item.name}(`), ev.signature)
  }
})

test("every indexed event names a contract in CONTRACTS", () => {
  for (const ev of INDEXED_EVENTS) assert.ok(ev.contract in CONTRACTS, ev.contract)
})

test("topic0 is unique across the registry", () => {
  const seen = new Map<string, string>()
  for (const ev of INDEXED_EVENTS) {
    const topic0 = toEventSelector(parseAbiItem(ev.signature) as AbiEvent)
    assert.ok(!seen.has(topic0), `${ev.signature} has the same topic0 as ${seen.get(topic0)}`)
    seen.set(topic0, ev.signature)
  }
})
