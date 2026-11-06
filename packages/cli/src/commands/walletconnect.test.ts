import { mock, test } from "node:test"
import assert from "node:assert/strict"
import { encodeFunctionData, type Hex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { CHAINS, CONTRACTS, erc20Abi } from "@cobuilders/safenet-core"
import { SignClient } from "@walletconnect/sign-client"
import { TEST_MNEMONIC } from "../test-support.js"
import { createRunner, type Context } from "../lib/index.js"
import { createWalletBridge, memoryStorage, walletConnectSigner, type WalletBridge, type WalletInteraction } from "./walletconnect.js"

const account = mnemonicToAccount(TEST_MNEMONIC)
const hash = `0x${"ab".repeat(32)}` as Hex
const tx = {
  to: CONTRACTS.safeToken.address,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACTS.staking.address, 1n] }),
  gas: 50_000n,
}
const prepared = { ...tx, value: 0n, chainId: CHAINS.mainnet.id, nonce: 0, type: "eip1559" as const, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n }
const namespace = () => ({ eip155: { accounts: [`eip155:${CHAINS.mainnet.id}:${account.address}`], methods: ["eth_sendTransaction"] } })

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
    sendRawTransaction: async () => { sent++; throw new Error("CLI must never broadcast WalletConnect transactions") },
  } } as unknown as Context
  const bridge: WalletBridge = {
    connect: async () => ({ uri: "wc:unit-test-pairing", approval: async () => session }),
    request: async (_topic, wire) => {
      requested++
      assert.match(review, /approve/)
      assert.deepEqual(wire, {
        from: account.address, to: tx.to, data: tx.data, value: "0x0", chainId: "0x1",
        type: "0x2", gas: "0xc350", nonce: "0x0", maxFeePerGas: "0xa", maxPriorityFeePerGas: "0x1",
      })
      return hash
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

test("SignClient requires and requests eth_sendTransaction", async () => {
  const connect = mock.fn(async () => ({ uri: "wc:unit-test-pairing", approval: async () => ({ topic: "topic", namespaces: namespace() }) }))
  const request = mock.fn(async () => hash)
  const init = mock.method(SignClient, "init", async () => ({ connect, request, session: { getAll: () => [] } }) as unknown as Awaited<ReturnType<typeof SignClient.init>>)
  let bridge: WalletBridge | undefined
  try {
    bridge = await createWalletBridge("0".repeat(32))
    await bridge.connect()
    assert.deepEqual(connect.mock.calls[0]?.arguments, [{ requiredNamespaces: {
      eip155: { chains: ["eip155:1"], methods: ["eth_sendTransaction"], events: ["accountsChanged", "chainChanged"] },
    } }])
    const wire = { from: account.address, to: tx.to, data: tx.data }
    assert.equal(await bridge.request("topic", wire), hash)
    assert.deepEqual(request.mock.calls[0]?.arguments, [{
      topic: "topic", chainId: "eip155:1", request: { method: "eth_sendTransaction", params: [wire] },
    }])
  } finally {
    await bridge?.close()
    init.mock.restore()
  }
})

test("requests wallet broadcast only after review, returns its hash, and closes once", async () => {
  const s = setup()
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  assert.equal(s.counts().uriShown, true)
  assert.equal(await signer.send(tx), hash)
  assert.match(s.counts().review, /maxFeePerGas/)
  assert.equal(s.counts().requested, 1)
  assert.equal(s.counts().sent, 0)
  await signer.close!()
  await signer.close!()
  assert.equal(s.counts().closed, 1)
})

test("the selected RPC polls the wallet hash and reports receipt confirmation", async () => {
  const s = setup()
  const polled: Hex[] = []
  Object.assign(s.ctx.client, {
    simulateContract: async () => ({}),
    estimateContractGas: async () => tx.gas,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      polled.push(hash)
      return { status: "success", blockNumber: 42n, gasUsed: 45_000n, logs: [] }
    },
  })
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  const progress: string[] = []
  const runner = await createRunner(s.ctx, { dryRun: false, signer }, { onProgress: (event) => progress.push(event.type) })
  const result = await runner.run({
    contract: "SAFE token", address: tx.to, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.staking.address, 1n],
  })
  assert.deepEqual(polled, [hash])
  assert.deepEqual(progress, ["sent", "confirmed"])
  assert.deepEqual(result.step.transaction, { hash, status: "success", block: 42n, gasUsed: 45_000n })
  assert.equal(s.counts().sent, 0)
  await signer.close!()
})

test("wrong RPC chain, wrong approved account, and missing send method close without a wallet request", async () => {
  for (const kind of ["chain", "account", "method"] as const) {
    const s = setup()
    if (kind === "chain") s.ctx.client.getChainId = async () => CHAINS.gnosis.id
    if (kind === "account") s.session.namespaces.eip155.accounts = [`eip155:${CHAINS.mainnet.id}:${CONTRACTS.staking.address}`]
    if (kind === "method") s.session.namespaces.eip155.methods = ["eth_signTransaction"]
    await assert.rejects(walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction), /Mainnet|unsupported/)
    assert.equal(s.counts().requested, 0)
    assert.equal(s.counts().closed, 1)
  }
})

test("cancelled review and disconnect never request wallet broadcast", async () => {
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

test("wallet rejection, timeout, cancellation and disconnect warn about possible wallet broadcast without leaking payloads", async () => {
  for (const kind of ["reject", "timeout", "change", "abort"] as const) {
    const s = setup()
    const controller = new AbortController()
    let finish: (value: unknown) => void = () => {}
    s.bridge.request = async () => {
      if (kind === "reject") throw new Error("wc:sensitive-uri")
      if (kind === "change") { s.change(); return hash }
      if (kind === "abort") { controller.abort(); return hash }
      return new Promise((resolve) => { finish = resolve })
    }
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, { ...s.interaction, signal: controller.signal })
    await assert.rejects(signer.send(tx), (error: Error) => {
      assert.match(error.message, /rejected|timed out|changed/)
      assert.match(error.message, /wallet may have broadcast.*check wallet activity before retrying/)
      assert.doesNotMatch(error.message, /sensitive-uri/)
      return true
    })
    finish(hash)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(s.counts().sent, 0)
    await assert.rejects(signer.send(tx), /cancelled|changed/)
    await signer.close!()
  }
})

test("pairing approval timeout closes the bridge", async () => {
  const s = setup()
  s.bridge.connect = async () => ({ uri: "wc:unit-test-pairing", approval: () => new Promise(() => {}) })
  await assert.rejects(walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction), /timed out/)
  assert.equal(s.counts().closed, 1)
})

test("accepts only a 32-byte transaction hash, never signed bytes or arbitrary wallet payloads", async () => {
  const signed = await account.signTransaction(prepared)
  for (const value of [undefined, null, 1, {}, { hash }, "", "0x", `0x${"ab".repeat(31)}`, `0x${"ab".repeat(33)}`, `0x${"gg".repeat(32)}`, hash.slice(2), signed, "wc:private-uri"]) {
    const s = setup()
    s.bridge.request = async () => value
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
    await assert.rejects(signer.send(tx), (error: Error) => {
      assert.match(error.message, /invalid transaction hash.*may have broadcast/)
      assert.doesNotMatch(error.message, /private-uri/)
      return true
    })
    assert.equal(s.counts().sent, 0)
    await signer.close!()
  }
  const s = setup()
  s.bridge.request = async () => `0x${"AB".repeat(32)}`
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  assert.equal(await signer.send(tx), `0x${"AB".repeat(32)}`)
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

test("zero priority fees and incidental RPC gasPrice normalize in the wallet request", async () => {
  const s = setup()
  const zeroFee = { ...prepared, gasPrice: 5n, maxPriorityFeePerGas: 0n }
  s.ctx.client.prepareTransactionRequest = (async () => zeroFee) as Context["client"]["prepareTransactionRequest"]
  s.bridge.request = async (_topic, wire) => {
    assert.equal(wire.gasPrice, undefined)
    assert.equal(wire.maxPriorityFeePerGas, "0x0")
    return hash
  }
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  assert.equal(await signer.send(tx), hash)
  assert.equal(s.counts().sent, 0)
  await signer.close!()
})

test("an RPC chain change during review refuses the wallet request", async () => {
  const s = setup()
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, {
    ...s.interaction,
    confirm: async () => { s.ctx.client.getChainId = async () => CHAINS.gnosis.id; return true },
  })
  await assert.rejects(signer.send(tx), /chain changed during review/)
  assert.equal(s.counts().requested, 0)
  await signer.close!()
})
