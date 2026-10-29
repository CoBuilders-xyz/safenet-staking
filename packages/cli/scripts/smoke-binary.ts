/** Runs the shipped executable, isolated from Node and workspace modules, over a loopback RPC fixture. */
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, numberToHex, type Hex } from "viem"
import { stakingAbi } from "@cobuilders/safenet-core"
import { BLOCK, BLOCK_TIME, STAKER, VALIDATOR_A, fakeContext } from "../src/test-support.js"
import pkg from "../package.json" with { type: "json" }

const execute = promisify(execFile)

export async function smokeBinary(binary: string, node?: string): Promise<void> {
  const alone = await mkdtemp(join(tmpdir(), "safenet-binary-smoke-"))
  const copy = join(alone, basename(binary))
  const seen: string[] = []
  const unexpected: string[] = []
  const ctx = fakeContext()
  // Use the package's existing fake chain and core's ABI. Only the wire adapter is new.
  async function contract(data: Hex): Promise<Hex> {
    const { functionName, args } = decodeFunctionData({ abi: [...stakingAbi, ...multicall3Abi], data })
    seen.push(functionName)
    if (functionName === "aggregate3") {
      const calls = args[0]
      const result = await Promise.all(calls.map(async (call) => ({ success: true, returnData: await contract(call.callData) })))
      return encodeFunctionResult({ abi: multicall3Abi, functionName, result })
    }
    if (functionName === "initiateWithdrawal") return "0x"
    const result = await ctx.client.readContract({ abi: stakingAbi, functionName, args } as never)
    return encodeFunctionResult({ abi: stakingAbi, functionName, result } as never)
  }
  async function rpc(request: { id: number; method: string; params?: unknown[] }) {
    const { id, method, params } = request
    seen.push(method)
    try {
      let result: unknown
      switch (method) {
        case "eth_chainId": result = "0x1"; break
        case "eth_blockNumber": result = numberToHex(BLOCK); break
        case "eth_getBlockByNumber": result = { number: numberToHex(BLOCK), timestamp: numberToHex(BLOCK_TIME), transactions: [] }; break
        case "eth_call": result = await contract((params![0] as { data: Hex }).data); break
        case "eth_estimateGas": result = numberToHex(50_000); break
        default: throw new Error(`Unexpected RPC method: ${method}`)
      }
      return { jsonrpc: "2.0", id, result }
    } catch (error) {
      unexpected.push(String(error))
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Unexpected fixture request" } }
    }
  }
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += String(chunk)
    const input = JSON.parse(body)
    const result = Array.isArray(input) ? await Promise.all(input.map(rpc)) : await rpc(input)
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
  })
  try {
    await copyFile(binary, copy)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    const endpoint = `http://127.0.0.1:${address.port}`
    // An explicit executable and an empty PATH work on Windows too. No NODE_PATH, NODE_OPTIONS,
    // signer settings, RPC credentials, or workspace environment enters the child.
    const env: NodeJS.ProcessEnv = {
      PATH: alone, HOME: alone, USERPROFILE: alone, TMPDIR: alone, TMP: alone, TEMP: alone,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    }
    const run = (...args: string[]) => execute(node ?? copy, node ? [copy, ...args] : args, {
      cwd: alone, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    })
    assert.equal((await run("--version")).stdout.trim(), pkg.version)
    assert.match((await run("--help")).stdout, /^Usage: safenet \[options\] \[command\]/)
    const read = JSON.parse((await run("withdrawals", "list", "--address", STAKER, "--rpc-url", endpoint, "--json")).stdout)
    assert.equal(read.scope, "address")
    assert.equal(read.block, String(BLOCK))
    assert.equal(read.total, String(7n * 10n ** 18n))
    assert.equal(read.withdrawals.value.length, 2)
    const dry = JSON.parse((await run("unstake", VALIDATOR_A, "1", "--dry-run", "--from", STAKER, "--rpc-url", endpoint, "--json")).stdout)
    assert.equal(dry.operation, "unstake")
    assert.equal(dry.dryRun, true)
    assert.equal(dry.amount.wei, String(10n ** 18n))
    assert.equal(dry.steps.length, 1)
    assert.equal(dry.steps[0].transaction, null)
    assert.match(dry.steps[0].function, /^initiateWithdrawal\(/)
    assert.equal(dry.steps[0].gas.value, "50000")
    // WalletConnect cannot silently become a headless signer in a compiled binary.
    await assert.rejects(run("unstake", VALIDATOR_A, "1", "--walletconnect", "--wallet-account", STAKER), (error: unknown) => {
      const failure = error as { code: number; stderr: string }
      assert.equal(failure.code, 2)
      assert.match(failure.stderr, /interactive terminal/)
      return true
    })
    assert.deepEqual(unexpected, [])
    assert.ok(seen.includes("getPendingWithdrawals"))
    assert.ok(seen.includes("initiateWithdrawal"))
    assert.ok(seen.includes("eth_estimateGas"))
    assert.ok(!seen.some((method) => /send|sign/i.test(method)), "a dry run must never sign or broadcast")
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(alone, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binary = process.argv[2]
  if (!binary) throw new Error("smoke-binary takes the executable path")
  await smokeBinary(resolve(binary))
  console.log("Binary smoke passed: version, help, read, simulated unstake without signing, and headless wallet refusal")
}
