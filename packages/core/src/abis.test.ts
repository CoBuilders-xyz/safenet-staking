import { test } from "node:test"
import assert from "node:assert/strict"
import { parseAbiItem, toEventSelector, type Abi, type AbiEvent } from "viem"
import { DECODED_ERRORS, INDEXED_EVENTS, erc20Abi, indexedEvent, merkleDropAbi, stakingAbi } from "./abis.js"
import { CONTRACTS, GNOSIS_CONTRACTS, type ContractName } from "./contracts.js"

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

test("topic0 is unique on each contract", () => {
  // Two contracts may emit one signature, as Aegis's coordinator emits Beta's; one contract
  // registering it twice would be proven once and read twice.
  const seen = new Map<string, string>()
  for (const ev of INDEXED_EVENTS) {
    const key = `${ev.contract} ${toEventSelector(parseAbiItem(ev.signature) as AbiEvent)}`
    assert.ok(!seen.has(key), `${ev.signature} has the same topic0 as ${seen.get(key)} on ${ev.contract}`)
    seen.set(key, ev.signature)
  }
})

test("each programme's consensus and coordinator register the events the Gnosis subgraph handles", () => {
  const names = (contract: ContractName) =>
    INDEXED_EVENTS.filter((ev) => ev.contract === contract).map((ev) => (parseAbiItem(ev.signature) as AbiEvent).name).sort()
  for (const [programme, roles] of Object.entries(GNOSIS_CONTRACTS)) {
    assert.deepEqual(
      names(roles.consensus),
      ["EpochRolledOver", "TransactionAttested", "TransactionProposed", "ValidatorStakerSet"],
      programme,
    )
    assert.deepEqual(names(roles.frostCoordinator), ["KeyGenConfirmed", "SignCompleted", "SignShared"], programme)
  }
})

test("an Aegis attestation names its ceremony by signatureId, as Beta's does", () => {
  // The Gnosis subgraph joins TransactionAttested to SignCompleted on this parameter.
  for (const roles of Object.values(GNOSIS_CONTRACTS)) {
    // The name is checked at runtime here, so the literal-type check is bypassed on purpose.
    const inputs = (indexedEvent(roles.consensus, "TransactionAttested" as never) as AbiEvent).inputs
    const sid = inputs.find((i) => i.name === "signatureId")
    assert.equal(sid?.type, "bytes32", roles.consensus)
    assert.equal(sid && "indexed" in sid ? sid.indexed : undefined, undefined, roles.consensus)
  }
})

test("indexedEvent returns the registered signature for every entry", () => {
  for (const ev of INDEXED_EVENTS) {
    const item = parseAbiItem(ev.signature) as AbiEvent
    // The name is only known at runtime here, so the literal-type check is bypassed on purpose.
    const found = indexedEvent(ev.contract, item.name as never) as AbiEvent
    assert.equal(toEventSelector(found), toEventSelector(item), ev.signature)
  }
})

test("indexedEvent refuses an event that is not registered on that contract", () => {
  assert.throws(() => indexedEvent("merkleDrop", "StakeIncreased" as never))
})

test("the staking read ABI declares getPendingWithdrawals as a view", () => {
  const fn = stakingAbi.find((i) => i.type === "function" && i.name === "getPendingWithdrawals")
  assert.ok(fn && fn.type === "function")
  assert.equal(fn.stateMutability, "view")
})

test("every decoded error parses as an error and is in the ABI of its contract", () => {
  const abiOf: Partial<Record<string, Abi>> = { staking: stakingAbi, merkleDrop: merkleDropAbi }
  for (const err of DECODED_ERRORS) {
    const item = parseAbiItem(err.signature)
    assert.equal(item.type, "error", err.signature)
    const abi = abiOf[err.contract]
    assert.ok(abi, `no ABI for ${err.contract}`)
    assert.ok(abi.some((i) => i.type === "error" && i.name === item.name), `${item.name} is not in the ${err.contract} ABI`)
  }
})

test("the staking ABI has the writes the CLI sends, and claimWithdrawal takes no id", () => {
  const fn = (name: string) =>
    stakingAbi.find((i): i is Extract<(typeof stakingAbi)[number], { type: "function" }> =>
      i.type === "function" && i.name === name)
  for (const name of ["stake", "initiateWithdrawal", "claimWithdrawal"]) {
    assert.equal(fn(name)?.stateMutability, "nonpayable", name)
  }
  assert.deepEqual(fn("claimWithdrawal")?.inputs, [])
  assert.deepEqual(fn("withdrawalNodes")?.outputs.map((o) => ("name" in o ? o.name : undefined)), ["amount", "claimableAt", "previous", "next"])
})

test("the ERC-20 ABI reads the allowance and sends the approval", () => {
  const fn = (name: string) => erc20Abi.find((i) => i.name === name)
  assert.equal(fn("allowance")?.stateMutability, "view")
  assert.equal(fn("approve")?.stateMutability, "nonpayable")
})

test("the MerkleDrop ABI has the owner's root update the manual QA fork sends", () => {
  const fn = (name: string) =>
    merkleDropAbi.find((i): i is Extract<(typeof merkleDropAbi)[number], { type: "function" }> =>
      i.type === "function" && i.name === name)
  assert.equal(fn("owner")?.stateMutability, "view")
  assert.equal(fn("setMerkleRoot")?.stateMutability, "nonpayable")
  assert.deepEqual(fn("setMerkleRoot")?.inputs.map((i) => i.type), ["bytes32"])
})
