import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { bytesToHex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { ANVIL_TEST_MNEMONIC } from "@cobuilders/safenet-core"

test("stdio startup emits one environment-key warning, without secrets or protocol output", () => {
  const key = bytesToHex(mnemonicToAccount(ANVIL_TEST_MNEMONIC).getHdKey().privateKey!)
  const keystore = fileURLToPath(new URL("../../cli/src/fixtures/keystore-anvil-1.json", import.meta.url))
  const cases = [
    { env: { SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_PRIVATE_KEY_ENV: "STARTUP_TEST_KEY", STARTUP_TEST_KEY: key }, warnings: 1 },
    { env: { SAFENET_MCP_ALLOW_WRITES: "0", SAFENET_MCP_PRIVATE_KEY_ENV: "STARTUP_TEST_KEY", STARTUP_TEST_KEY: key }, warnings: 0 },
    { env: { SAFENET_MCP_ALLOW_WRITES: "1", SAFENET_MCP_KEYSTORE: keystore, SAFENET_MCP_PASSWORD_ENV: "PW", PW: "safenet fixture" }, warnings: 0 },
  ]
  for (const { env, warnings } of cases) {
    // No tool calls, archive endpoints or inherited credentials. EOF closes the stdio session.
    const result = spawnSync(process.execPath, ["--conditions=source", "--import", "tsx", "src/index.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, input: "", encoding: "utf8", timeout: 15_000,
    })
    assert.equal(result.status, 0, "the server must exit cleanly after stdin closes")
    assert.equal(result.stdout, "", "startup notices must not enter the JSON-RPC stream")
    assert.equal((result.stderr.match(/environment private keys/g) ?? []).length, warnings)
    assert.ok(!result.stderr.includes(key.slice(2)))
    assert.doesNotMatch(result.stderr, /STARTUP_TEST_KEY|safenet fixture/)
    if (warnings) assert.match(result.stderr, /SAFENET_MCP_KEYSTORE with SAFENET_MCP_PASSWORD_ENV/)
  }
})
