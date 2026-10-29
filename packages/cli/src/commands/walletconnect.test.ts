import { test } from "node:test"
import assert from "node:assert/strict"
import { encodeFunctionData, keccak256, type Hex, type TransactionSerializable } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { CHAINS, CONTRACTS, erc20Abi } from "@cobuilders/safenet-core"
import { TEST_MNEMONIC } from "../test-support.js"
import type { Context } from "../lib/index.js"
import { memoryStorage, walletConnectSigner, type WalletBridge, type WalletInteraction } from "./walletconnect.js"

const account = mnemonicToAccount(TEST_MNEMONIC)
const tx = {
  to: CONTRACTS.safeToken.address,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACTS.staking.address, 1n] }),
  gas: 50_000n,
}
const prepared = { ...tx, value: 0n, chainId: CHAINS.mainnet.id, nonce: 0, type: "eip1559" as const, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n }
const namespace = () => ({ eip155: { accounts: [`eip155:${CHAINS.mainnet.id}:${account.address}`], methods: ["eth_signTransaction"] } })

function setup() {
  let changed = () => {}
  let closed = 0
  let sent = 0
  let requested = 0
  let review = ""
  let uriShown = false
  const session = { topic: "unit-test-session", namespaces: namespace() }
  const ctx = { client: {
    getChainId: async () => CHAINS.mainnet.id,
    prepareTransactionRequest: async () => prepared,
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      sent++
      return keccak256(serializedTransaction)
    },
  } } as unknown as Context
  const bridge: WalletBridge = {
    connect: async () => ({ uri: "wc:unit-test-pairing", approval: async () => session }),
    request: async (_topic, wire) => {
      requested++
      assert.equal(wire.from, account.address)
      assert.equal(wire.to, tx.to)
      assert.equal(wire.data, tx.data)
      return account.signTransaction(prepared)
    },
    onChange: (listener) => { changed = listener; return () => { changed = () => {} } },
    close: async () => { closed++ },
  }
  const interaction: WalletInteraction = {
    timeoutMs: 50,
    showUri: async () => { uriShown = true },
    confirm: async (text) => { review = text; return true },
  }
  return { ctx, bridge, interaction, session, change: () => changed(), counts: () => ({ closed, sent, requested, review, uriShown }) }
}

test("signs only after review, verifies bytes, broadcasts with selected RPC and closes once", async () => {
  const s = setup()
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  assert.equal(s.counts().uriShown, true)
  const hash = await signer.send(tx)
  assert.equal(hash, keccak256(await account.signTransaction(prepared)))
  assert.match(s.counts().review, /approve/)
  assert.match(s.counts().review, /maxFeePerGas/)
  assert.equal(s.counts().sent, 1)
  await signer.close!()
  await signer.close!()
  assert.equal(s.counts().closed, 1)
})

test("wrong RPC chain, wrong approved account, and missing signing method close without signing", async () => {
  for (const kind of ["chain", "account", "method"] as const) {
    const s = setup()
    if (kind === "chain") s.ctx.client.getChainId = async () => CHAINS.gnosis.id
    if (kind === "account") s.session.namespaces.eip155.accounts = [`eip155:${CHAINS.mainnet.id}:${CONTRACTS.staking.address}`]
    if (kind === "method") s.session.namespaces.eip155.methods = ["eth_sendTransaction"]
    await assert.rejects(walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction), /Mainnet|unsupported/)
    assert.equal(s.counts().requested, 0)
    assert.equal(s.counts().closed, 1)
  }
})

test("cancelled review and disconnect never request a signature", async () => {
  for (const kind of ["cancel", "disconnect", "abort"] as const) {
    const s = setup()
    const controller = new AbortController()
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, {
      ...s.interaction, signal: controller.signal, confirm: async () => false,
    })
    if (kind === "disconnect") s.change()
    if (kind === "abort") controller.abort()
    await assert.rejects(signer.send(tx), /[Cc]ancelled|disconnected/)
    assert.equal(s.counts().requested, 0)
    assert.equal(s.counts().sent, 0)
    await signer.close!()
  }
})

test("wallet rejection, timeout, and late signature never broadcast", async () => {
  for (const kind of ["reject", "timeout", "change"] as const) {
    const s = setup()
    let finish: (value: unknown) => void = () => {}
    s.bridge.request = async () => {
      if (kind === "reject") throw new Error("wc:sensitive-uri")
      if (kind === "change") { s.change(); return account.signTransaction(prepared) }
      return new Promise((resolve) => { finish = resolve })
    }
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
    await assert.rejects(signer.send(tx), /signature was rejected|timed out|changed/)
    finish(await account.signTransaction(prepared))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(s.counts().sent, 0)
    await signer.close!()
  }
})

test("pairing approval timeout and cancellation close the bridge", async () => {
  const s = setup()
  s.bridge.connect = async () => ({ uri: "wc:unit-test-pairing", approval: () => new Promise(() => {}) })
  await assert.rejects(walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction), /timed out/)
  assert.equal(s.counts().closed, 1)
})

test("every signed field and the recovered account must match before broadcast", async () => {
  const changes: Partial<TransactionSerializable>[] = [
    { to: CONTRACTS.staking.address }, { data: "0x" }, { value: 1n }, { nonce: 1 },
    { gas: tx.gas + 1n }, { chainId: CHAINS.gnosis.id }, { maxFeePerGas: 11n }, { maxPriorityFeePerGas: 2n },
    { accessList: [{ address: tx.to, storageKeys: [] }] },
  ]
  for (const change of changes) {
    const s = setup()
    s.bridge.request = () => account.signTransaction({ ...prepared, ...change } as TransactionSerializable)
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
    await assert.rejects(signer.send(tx), /different|invalid/)
    assert.equal(s.counts().sent, 0)
    await signer.close!()
  }
  const s = setup()
  s.bridge.request = () => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }).signTransaction(prepared)
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  await assert.rejects(signer.send(tx), /different|invalid/)
  await signer.close!()
})

test("broadcast uncertainty reports the known hash without wallet payload", async () => {
  const s = setup()
  s.ctx.client.sendRawTransaction = async () => { throw new Error("wc:private-uri") }
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  const expectedHash = keccak256(await account.signTransaction(prepared))
  await assert.rejects(signer.send(tx), (error: Error) => {
    assert.ok(error.message.includes(expectedHash))
    assert.ok(!error.message.includes("private-uri"))
    return true
  })
  await signer.close!()
})

test("memory storage is fresh per invocation and clears all session material", async () => {
  const first = memoryStorage()
  await first.setItem("pairing", { secret: "unit-test-only" })
  assert.deepEqual(await first.getKeys(), ["pairing"])
  assert.equal(await memoryStorage().getItem("pairing"), undefined)
  first.clear()
  assert.deepEqual(await first.getEntries(), [])
})

test("zero priority fees and incidental RPC gasPrice normalize without changing signed fields", async () => {
  const s = setup()
  const zeroFee = { ...prepared, gasPrice: 5n, maxPriorityFeePerGas: 0n }
  s.ctx.client.prepareTransactionRequest = (async () => zeroFee) as Context["client"]["prepareTransactionRequest"]
  s.bridge.request = async (_topic, wire) => {
    assert.equal(wire.gasPrice, undefined)
    return account.signTransaction({ ...prepared, maxPriorityFeePerGas: 0n })
  }
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  await signer.send(tx)
  assert.equal(s.counts().sent, 1)
  await signer.close!()
})

test("an RPC chain change during review refuses the signature", async () => {
  const s = setup()
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, {
    ...s.interaction,
    confirm: async () => { s.ctx.client.getChainId = async () => CHAINS.gnosis.id; return true },
  })
  await assert.rejects(signer.send(tx), /chain changed during review/)
  assert.equal(s.counts().requested, 0)
  await signer.close!()
})
