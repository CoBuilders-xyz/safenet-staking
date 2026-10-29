import { test } from "node:test"
import assert from "node:assert/strict"
import { mnemonicToAccount } from "viem/accounts"
import { parseOptions, writeSchema } from "./options.js"
import { loadSigner } from "./signer.js"
import { errorSentence, scrubUsage, run } from "../cli.js"
import { fakeRuntime, type FakeOptions, TEST_MNEMONIC, VALIDATOR_A, STAKER } from "../test-support.js"
import type { Context } from "../lib/index.js"

async function cli(argv: string[], options: FakeOptions = {}) {
  const rt = fakeRuntime(options)
  return { code: await run(argv, rt), out: rt.stdout(), err: rt.stderr() }
}

const account = mnemonicToAccount(TEST_MNEMONIC)

test("WalletConnect requires an expected account and excludes other signer modes", () => {
  for (const options of [
    { walletconnect: true }, { walletAccount: account.address },
    { walletconnect: true, walletAccount: account.address, privateKeyEnv: "KEY" },
    { walletconnect: true, walletAccount: account.address, keystore: "wallet.json" },
    { walletconnect: true, walletAccount: account.address, passwordEnv: "PASSWORD" },
  ]) assert.throws(() => parseOptions(writeSchema, options))
  assert.deepEqual(parseOptions(writeSchema, { walletconnect: true, walletAccount: account.address }).signer,
    { kind: "walletconnect", address: account.address })
})

test("headless WalletConnect fails before it initializes a bridge", async () => {
  await assert.rejects(loadSigner({ kind: "walletconnect", address: account.address }, {} as Context,
    { env: {}, askPassword: undefined }), /interactive terminal/)
})

test("every wallet invocation closes its signer on dry run, success, simulation failure, and address mismatch", async () => {
  for (const kind of ["dry", "success", "simulation", "mismatch"] as const) {
    let closed = 0
    let signed = 0
    const args = ["stake", VALIDATOR_A, "1", "--walletconnect", "--wallet-account", account.address]
    if (kind === "dry" || kind === "mismatch") args.push("--dry-run")
    if (kind === "mismatch") args.push("--from", STAKER)
    const result = await cli(args, {
      ...(kind === "simulation" ? { rpcError: new Error("simulation failed") } : {}),
      loadSigner: async () => ({
        address: account.address,
        send: async () => { signed++; throw new Error("signature requested") },
        close: async () => { closed++ },
      }),
    })
    assert.equal(closed, 1, kind)
    assert.equal(signed, kind === "success" ? 1 : 0, kind)
    if (kind === "dry") assert.equal(result.code, 0)
  }
})

test("environment key warnings occur on every run, including dry runs and invalid keys", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await cli(["stake", VALIDATOR_A, "1", "--dry-run", "--private-key-env", "KEY"], { env: { KEY: "invalid" } })
    assert.equal(r.code, 2)
    assert.match(r.err, /^Warning: environment private keys/)
    assert.equal((r.err.match(/Warning:/g) ?? []).length, 1)
  }
})

test("pairing URIs are removed from ordinary and verbose error redaction", () => {
  const uri = "wc:unit-test-topic@2?relay-protocol=irn&symKey=unit-test-only"
  assert.ok(!scrubUsage(`bad argument ${uri}`).includes("unit-test"))
  assert.ok(!errorSentence(new Error(`failed ${uri}`)).includes("unit-test"))
})
