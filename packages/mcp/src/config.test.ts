import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { bytesToHex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import type { Context } from "@cobuilders/safenet-cli/lib"
import { ConfigError, readConfig } from "./config.js"
import { signerLoader } from "./signer.js"
import { KEY_LIKE_VALUE, PASSWORD_VALUE } from "./test-support.js"

// The settings read at start, and the signer they lead to. No network.

const TEST_MNEMONIC = "test test test test test test test test test test test junk"
const account0 = mnemonicToAccount(TEST_MNEMONIC)
const TEST_KEY = bytesToHex(account0.getHdKey().privateKey!)
// Written by Foundry's `cast wallet import` for account 1 of the test mnemonic; the CLI's tests use it too.
const KEYSTORE = fileURLToPath(new URL("../../cli/src/fixtures/keystore-anvil-1.json", import.meta.url))
const KEYSTORE_PASSWORD = "safenet fixture"
const ctx = { client: {} } as unknown as Context

const refused = (env: Record<string, string>, message: RegExp) =>
  assert.throws(() => readConfig(env), (err: Error) => err instanceof ConfigError && message.test(err.message))

test("with nothing set, writes are off, the RPC is left to the library, and nothing is said", () => {
  const c = readConfig({})
  assert.equal(c.writes.allowed, false)
  assert.equal(c.rpcUrl, undefined)
  assert.deepEqual(c.notices, [])
})

test("SAFENET_MCP_RPC_URL is taken when set; GITHUB_TOKEN, else GH_TOKEN", () => {
  assert.equal(readConfig({ SAFENET_MCP_RPC_URL: "https://rpc.invalid" }).rpcUrl, "https://rpc.invalid")
  assert.equal(readConfig({ GH_TOKEN: "b" }).githubToken, "b")
  assert.equal(readConfig({ GITHUB_TOKEN: "a", GH_TOKEN: "b" }).githubToken, "a")
  refused({ SAFENET_MCP_RPC_URL: "ws://rpc.invalid/key" }, /^SAFENET_MCP_RPC_URL must be an http or https URL$/)
})

test("writes are allowed only with SAFENET_MCP_ALLOW_WRITES=1 and a signer", () => {
  const key = { SAFENET_MCP_PRIVATE_KEY_ENV: "SAFENET_TEST_KEY", SAFENET_TEST_KEY: TEST_KEY }
  assert.deepEqual(readConfig({ SAFENET_MCP_ALLOW_WRITES: "1", ...key }).writes, {
    allowed: true, signer: { kind: "private-key-env", name: "SAFENET_TEST_KEY" },
  })
  const keystore = { SAFENET_MCP_KEYSTORE: KEYSTORE, SAFENET_MCP_PASSWORD_ENV: "PW", PW: KEYSTORE_PASSWORD }
  assert.deepEqual(readConfig({ SAFENET_MCP_ALLOW_WRITES: "1", ...keystore }).writes, {
    allowed: true, signer: { kind: "keystore", path: KEYSTORE, passwordEnv: "PW" },
  })

  const noSigner = readConfig({ SAFENET_MCP_ALLOW_WRITES: "1" })
  assert.equal(noSigner.writes.allowed, false)
  assert.match(noSigner.notices[0] ?? "", /no signer is/)

  for (const allow of [undefined, "0"]) {
    const c = readConfig({ ...(allow ? { SAFENET_MCP_ALLOW_WRITES: allow } : {}), ...key })
    assert.equal(c.writes.allowed, false)
    assert.match(c.notices[0] ?? "", /it is not loaded/)
  }
  refused({ SAFENET_MCP_ALLOW_WRITES: "true", ...key }, /^SAFENET_MCP_ALLOW_WRITES takes 1/)
})

test("a signer setting that holds a secret instead of a name is refused without repeating it", () => {
  for (const [setting, value] of [
    ["SAFENET_MCP_PRIVATE_KEY_ENV", KEY_LIKE_VALUE],
    ["SAFENET_MCP_PRIVATE_KEY_ENV", KEY_LIKE_VALUE.slice(2)],
    ["SAFENET_MCP_PASSWORD_ENV", PASSWORD_VALUE],
  ] as const) {
    assert.throws(
      () => readConfig({ SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_KEYSTORE: KEYSTORE, [setting]: value }),
      (err: Error) => err.message === `${setting} takes the name of an environment variable that holds the secret, never the secret itself`,
    )
  }
})

test("signer settings that do not fit together, or point at nothing, stop the server", () => {
  refused({ SAFENET_MCP_PRIVATE_KEY_ENV: "A", SAFENET_MCP_KEYSTORE: KEYSTORE }, /cannot be used together/)
  refused({ SAFENET_MCP_PASSWORD_ENV: "PW" }, /only works with SAFENET_MCP_KEYSTORE/)
  refused({ SAFENET_MCP_KEYSTORE: KEYSTORE }, /needs SAFENET_MCP_PASSWORD_ENV/)
  refused({ SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_PRIVATE_KEY_ENV: "UNSET_KEY" }, /^The environment variable named by SAFENET_MCP_PRIVATE_KEY_ENV is not set$/)
  refused(
    { SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_KEYSTORE: "/nonexistent/keystore.json", SAFENET_MCP_PASSWORD_ENV: "PW", PW: "x" },
    /does not exist/,
  )
  refused({ SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_KEYSTORE: KEYSTORE, SAFENET_MCP_PASSWORD_ENV: "UNSET_PW" }, /PASSWORD_ENV is not set/)
})

test("the signer comes from the named variable, or from the keystore and its password", async () => {
  const fromKey = await signerLoader({ K: TEST_KEY })({ kind: "private-key-env", name: "K" }, ctx)
  assert.equal(fromKey.address, account0.address)
  const fromKeystore = await signerLoader({ PW: KEYSTORE_PASSWORD })({ kind: "keystore", path: KEYSTORE, passwordEnv: "PW" }, ctx)
  assert.equal(fromKeystore.address, mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }).address)
})

test("a variable that does not hold a key is refused without repeating its value", async () => {
  await assert.rejects(
    signerLoader({ K: PASSWORD_VALUE })({ kind: "private-key-env", name: "K" }, ctx),
    (err: Error) => /does not hold a private key/.test(err.message) && !err.message.includes(PASSWORD_VALUE),
  )
  await assert.rejects(
    signerLoader({ PW: PASSWORD_VALUE })({ kind: "keystore", path: KEYSTORE, passwordEnv: "PW" }, ctx),
    (err: Error) => /password is wrong/.test(err.message) && !err.message.includes(PASSWORD_VALUE),
  )
})
