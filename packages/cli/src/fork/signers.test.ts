/** Real contract effects for three signers; WalletConnect transport is emulated, never hardware evidence. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, parseEther, type Address, type Hex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { CHAINS } from "@cobuilders/safenet-core"
import { run, type Runtime } from "../cli.js"
import { loadSigner } from "../commands/signer.js"
import { walletConnectSigner, type WalletBridge } from "../commands/walletconnect.js"
import { createContext } from "../lib/index.js"
import { TEST_MNEMONIC } from "../test-support.js"
import { startAnvil } from "./anvil.js"
import { activeValidator, forkClients, fundSafe, stakeOf } from "./chain.js"

const skip = process.env.SAFENET_FORK_SUITE === "1" ? false : "requires the isolated Anvil fork suite"

test("env, keystore password prompt, and emulated WalletConnect sign real fork stakes; dry runs send nothing", { skip, timeout: 180_000 }, async () => {
  const forkUrl = process.env.MAINNET_RPC_URL
  assert.ok(forkUrl, "MAINNET_RPC_URL is required")
  // A dedicated port, never the manual QA fork or the other CLI fork suite.
  const port = Number(process.env.CLI_SIGNER_ANVIL_PORT ?? "28581")
  const anvil = await startAnvil(forkUrl, port, () => {})
  try {
    const c = forkClients(anvil.url)
    const validator = await activeValidator(c)
    for (const [index, mode] of ["env", "keystore", "walletconnect"].entries()) {
      const account = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index })
      await c.test.setBalance({ address: account.address, value: parseEther("10") })
      await fundSafe(c, account.address, parseEther("3"))
      let prompts = 0
      let signatures = 0
      let closes = 0
      let reviews = 0
      let err = ""
      let out = ""
      const env = { FORK_SIGNER_KEY: bytesToHex(account.getHdKey().privateKey!) }
      const bridge: WalletBridge = {
        connect: async () => ({ uri: "wc:emulated-test-only", approval: async () => ({
          topic: "emulated", namespaces: { eip155: {
            accounts: [`eip155:${CHAINS.mainnet.id}:${account.address}`], methods: ["eth_sendTransaction"],
          } },
        }) }),
        onChange: () => () => {},
        close: async () => { closes++ },
        async request(_topic, wire) {
          signatures++
          const serializedTransaction = await account.signTransaction({
            chainId: Number(wire.chainId), to: wire.to as Address, data: wire.data as Hex,
            value: BigInt(wire.value!), nonce: Number(wire.nonce), gas: BigInt(wire.gas!),
            type: "eip1559", maxFeePerGas: BigInt(wire.maxFeePerGas!), maxPriorityFeePerGas: BigInt(wire.maxPriorityFeePerGas!),
          })
          // Emulate the wallet's broadcast, using the same isolated fork as the CLI.
          return c.chain.sendRawTransaction({ serializedTransaction })
        },
      }
      const runtime: Runtime = {
        io: { out: (line) => { out += line }, err: (line) => { err += line } }, env, createContext,
        loadSigner: (request, ctx) => request.kind === "walletconnect"
          ? walletConnectSigner(ctx, request.address, bridge, {
            showUri: async () => {}, confirm: async () => { reviews++; return true },
          })
          : loadSigner(request, ctx, {
            env, askPassword: async () => { prompts++; return "safenet fixture" },
          }),
      }
      const options = mode === "env" ? ["--private-key-env", "FORK_SIGNER_KEY"]
        : mode === "keystore" ? ["--keystore", new URL("../fixtures/keystore-anvil-1.json", import.meta.url).pathname]
          : ["--walletconnect", "--wallet-account", account.address]
      const argv = ["--rpc-url", anvil.url, "stake", validator, "1", ...options, "--json"]
      const before = await stakeOf(c, account.address, validator)
      assert.equal(await run(argv, runtime), 0, `${mode}: ${err}`)
      assert.equal(await stakeOf(c, account.address, validator) - before, parseEther("1"), mode)
      const result = JSON.parse(out) as { steps: { transaction: { status: string } }[] }
      assert.equal(result.steps.length, 2)
      assert.ok(result.steps.every((s) => s.transaction.status === "success"))
      if (mode === "env") assert.match(err, /Warning: environment private keys/)
      if (mode === "keystore") assert.equal(prompts, 1)
      if (mode === "walletconnect") {
        assert.equal(signatures, 2)
        assert.equal(reviews, 2)
        assert.equal(closes, 1)
      }
      const nonce = await c.chain.getTransactionCount({ address: account.address })
      out = ""; err = ""
      assert.equal(await run([...argv, "--dry-run"], runtime), 0, `${mode} dry run: ${err}`)
      assert.equal(await c.chain.getTransactionCount({ address: account.address }), nonce)
      assert.equal(await stakeOf(c, account.address, validator) - before, parseEther("1"))
      if (mode === "walletconnect") { assert.equal(signatures, 2); assert.equal(closes, 2) }
    }
  } finally { await anvil.stop() }
})
