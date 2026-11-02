import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { encodeAbiParameters, erc6492SignatureValidatorAbi, erc6492SignatureValidatorByteCode, hashMessage, numberToHex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { CHAINS, CONTRACTS } from "@cobuilders/safenet-core"
import { verifyWallet } from "./auth.js"
import type { Env } from "./types.js"

test("contract-wallet verification uses the contract address and message; an owner signature alone cannot authenticate it", async () => {
  const owner = privateKeyToAccount(generatePrivateKey())
  const message = "Contract-wallet authentication test"
  const signature = await owner.signMessage({ message })
  const address = CONTRACTS.staking.address
  const env: Env = { APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused", MAINNET_RPC_URL: "https://rpc.test" }
  let approved = false
  let wrongChain = false
  let calls = 0
  const constructor = erc6492SignatureValidatorAbi.find(item => item.type === "constructor")!
  const expected = erc6492SignatureValidatorByteCode + encodeAbiParameters(constructor.inputs, [address, hashMessage(message), signature]).slice(2)
  const mocked = mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const rpc = JSON.parse(String(init!.body))
    if (rpc.method === "eth_chainId") return Response.json({ id: rpc.id, jsonrpc: "2.0", result: numberToHex(wrongChain ? CHAINS.gnosis.id : CHAINS.mainnet.id) })
    assert.equal(rpc.method, "eth_call")
    assert.equal(rpc.params[0].data.toLowerCase(), expected.toLowerCase())
    calls++
    return Response.json({ id: rpc.id, jsonrpc: "2.0", result: numberToHex(approved ? 1 : 0) })
  })
  try {
    assert.equal(await verifyWallet(env, { address, message, signature }), false)
    approved = true
    assert.equal(await verifyWallet(env, { address, message, signature }), true)
    wrongChain = true
    await assert.rejects(verifyWallet(env, { address, message, signature }), /chain mismatch/)
    assert.equal(calls, 2)
  } finally { mocked.mock.restore() }
})
