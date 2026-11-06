import { mock, test } from "node:test"
import assert from "node:assert/strict"
import { encodeFunctionData, type Hex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { CHAINS, CONTRACTS, erc20Abi } from "@cobuilders/safenet-core"
import { SignClient } from "@walletconnect/sign-client"
import { fakeRuntime, TEST_MNEMONIC, VALIDATOR_A } from "../test-support.js"
import { run } from "../cli.js"
import { createRunner, type Context } from "../lib/index.js"
import { createWalletBridge, memoryStorage, walletConnectSigner, type WalletBridge, type WalletInteraction } from "./walletconnect.js"

const account = mnemonicToAccount(TEST_MNEMONIC)
const hash = `0x${"ab".repeat(32)}` as Hex
const secondHash = `0x${"cd".repeat(32)}` as Hex
const replacementHash = `0x${"12".repeat(32)}` as Hex
const blockHash = `0x${"ef".repeat(32)}` as Hex
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
    getTransactionCount: async () => 0,
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

test("the selected RPC verifies the mined call after receipt polling and before reporting confirmation", async () => {
  const s = setup()
  const polled: Hex[] = []
  const events: string[] = []
  Object.assign(s.ctx.client, {
    simulateContract: async () => ({}),
    estimateContractGas: async () => tx.gas,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      polled.push(hash)
      events.push("receipt")
      return { transactionHash: hash, blockHash, status: "success", blockNumber: 42n, gasUsed: 45_000n, logs: [] }
    },
    getTransaction: async ({ hash: requestedHash }: { hash: Hex }) => {
      events.push("lookup")
      assert.equal(requestedHash, hash)
      return { hash, blockHash, from: account.address.toLowerCase(), to: tx.to.toLowerCase(), input: tx.data, value: 0n,
        nonce: 99, gas: 90_000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 50n }
    },
  })
  const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
  const progress: string[] = []
  const runner = await createRunner(s.ctx, { dryRun: false, signer }, { onProgress: (event) => {
    progress.push(event.type)
    events.push(event.type)
  } })
  const result = await runner.run({
    contract: "SAFE token", address: tx.to, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.staking.address, 1n],
  })
  assert.deepEqual(polled, [hash])
  assert.deepEqual(progress, ["sent", "confirmed"])
  assert.deepEqual(events, ["sent", "receipt", "lookup", "confirmed"])
  assert.deepEqual(result.step.transaction, { hash, status: "success", block: 42n, gasUsed: 45_000n })
  assert.equal(s.counts().sent, 0)
  await signer.close!()
})

/** Run approve then stake through the real CLI flow, with controlled mined RPC responses. */
async function stakeFlow(lookup: (mined: Record<string, unknown>, index: number) => Promise<unknown>, replacement = false, nonceFloor = 0) {
  const s = setup()
  const requests: Record<string, string>[] = []
  const lookups: Hex[] = []
  s.bridge.request = async (_topic, wire) => {
    requests.push(wire)
    return requests.length === 1 ? hash : secondHash
  }
  let signer: Awaited<ReturnType<typeof walletConnectSigner>> | undefined
  const runtime = fakeRuntime({ loadSigner: async (_request, ctx) => {
    Object.assign(ctx.client, {
      getTransactionCount: async () => nonceFloor + requests.length,
      waitForTransactionReceipt: async ({ hash: sentHash }: { hash: Hex }) => ({
        transactionHash: replacement && sentHash === hash ? replacementHash : sentHash, blockHash,
        status: "success", blockNumber: 42n, gasUsed: 45_000n, logs: [],
      }),
      getTransaction: async ({ hash: minedHash }: { hash: Hex }) => {
        lookups.push(minedHash)
        const wire = requests.at(-1)!
        return lookup({ hash: minedHash, blockHash, from: wire.from, to: wire.to, input: wire.data, value: 0n,
          nonce: 99, gas: 90_000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 50n }, requests.length - 1)
      },
    })
    signer = await walletConnectSigner(ctx, account.address, s.bridge, s.interaction)
    return signer
  } })
  const code = await run(["stake", VALIDATOR_A, "1", "--walletconnect", "--wallet-account", account.address, "--json"], runtime)
  return { code, requests, lookups, signer, out: runtime.stdout(), err: runtime.stderr(), counts: s.counts() }
}

test("verified approval allows stake, including wallet changes to nonce, gas, and fees", async () => {
  const result = await stakeFlow(async (mined) => mined)
  assert.equal(result.code, 0, result.err)
  assert.equal(result.requests.length, 2)
  assert.deepEqual(result.lookups, [hash, secondHash])
  assert.equal((result.err.match(/confirmed /g) ?? []).length, 2)
  assert.equal(result.counts.sent, 0)
  assert.equal(result.counts.closed, 1)
})

test("confirmation reports the verified replacement hash rather than the original wallet hash", async () => {
  const result = await stakeFlow(async (mined, index) => ({ ...mined, nonce: 10 + index }), true, 10)
  assert.equal(result.code, 0, result.err)
  assert.deepEqual(result.lookups, [replacementHash, secondHash])
  const output = JSON.parse(result.out) as { steps: { transaction: { hash: Hex } }[] }
  assert.equal(output.steps[0]!.transaction.hash, replacementHash)
})

test("an older identical approval cannot confirm a new request, even with the same receipt block", async () => {
  // Nonce 9 was consumed before dispatch. The current wallet may use nonce 10 or higher.
  // Keep every call field, hash, and block match intact: only nonce freshness rejects the replay.
  const result = await stakeFlow(async (mined) => ({ ...mined, nonce: 9 }), false, 10)
  assert.equal(result.code, 1)
  assert.equal(result.requests.length, 1)
  assert.match(result.err, /could not be verified.*may already have broadcast/)
  assert.doesNotMatch(result.err, /^confirmed /m)
  assert.equal(result.counts.closed, 1)
})

test("nonce lookup failure or invalid data prevents sending the wallet request", async () => {
  for (const nonce of ["failure", -1, Number.NaN, 0.5]) {
    const s = setup()
    s.ctx.client.getTransactionCount = async () => {
      if (typeof nonce === "string") throw new Error("wc:private-rpc-payload")
      return nonce
    }
    const signer = await walletConnectSigner(s.ctx, account.address, s.bridge, s.interaction)
    await assert.rejects(signer.send(tx), (error: Error) => {
      assert.match(error.message, /nonce.*(rejected|invalid)|invalid account nonce/)
      assert.doesNotMatch(error.message, /private-rpc-payload/)
      return true
    })
    assert.equal(s.counts().requested, 0)
    await signer.close!()
  }
})

test("mismatched or unverifiable mined approval stops the CLI before stake and invalidates the wallet", async () => {
  const changes = [
    { from: CONTRACTS.staking.address }, { to: CONTRACTS.staking.address }, { input: "0x" }, { value: 1n },
    { hash: secondHash }, { blockHash: secondHash }, { blockHash: null },
    { from: undefined }, { to: null }, { input: undefined }, { value: undefined },
  ]
  const failures = [
    ...changes.map((change) => async (mined: Record<string, unknown>) => ({ ...mined, ...change })),
    async () => { throw new Error("wc:private-rpc-payload") },
    async () => new Promise<never>(() => {}),
  ]
  for (const lookup of failures) {
    const result = await stakeFlow(lookup)
    assert.equal(result.code, 1)
    assert.equal(result.requests.length, 1)
    assert.match(result.err, /could not be verified against the reviewed call/)
    assert.match(result.err, /may already have broadcast.*check wallet activity/)
    assert.ok(result.err.includes(hash))
    assert.doesNotMatch(result.err, /confirmed |private-rpc-payload|nothing was (sent|broadcast)/)
    assert.equal(result.out, "")
    assert.equal(result.counts.sent, 0)
    assert.equal(result.counts.closed, 1)
    await assert.rejects(result.signer!.send(tx), /cancelled|changed/)
  }
})

test("a later verification failure retains the confirmed approval and never confirms stake", async () => {
  const result = await stakeFlow(async (mined, index) => index === 0 ? mined : { ...mined, value: 1n })
  assert.equal(result.code, 1)
  assert.equal(result.requests.length, 2)
  assert.equal((result.err.match(/^confirmed /gm) ?? []).length, 1)
  assert.match(result.err, /may already have broadcast.*already confirmed, and not undone/)
  assert.ok(result.err.includes(hash))
  assert.ok(result.err.includes(secondHash))
  assert.doesNotMatch(result.err, /^confirmed Staking\.stake/m)
  assert.equal(result.counts.closed, 1)
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
