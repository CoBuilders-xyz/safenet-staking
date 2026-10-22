/**
 * The server over stdio, against Ethereum Mainnet: started as a child process, as a desktop
 * client starts it, and called through the SDK's client.
 *
 * Gated on MAINNET_RPC_URL. Without it each test is skipped and says why. Turborepo's strict
 * environment mode hides the variable from the root `pnpm test`, so these always skip there; the
 * nightly workflow runs them with the secret.
 *
 *   pnpm --filter @cobuilders/safenet-mcp test:smoke     reads MAINNET_RPC_URL from .env.local
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { connectStdio } from "../../scripts/stdio-client.js"

const skip = process.env.MAINNET_RPC_URL
  ? false
  : "MAINNET_RPC_URL is not set. These read Mainnet; run `pnpm --filter @cobuilders/safenet-mcp test:smoke` with it"
const TIMEOUT = 180_000

let server: Awaited<ReturnType<typeof connectStdio>> | undefined

before(async () => {
  if (skip) return
  // The server's own settings are cleared, so a shell that sets an RPC endpoint or allows writes
  // runs the test as it runs in CI: reads through MAINNET_RPC_URL, writes off.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SAFENET_MCP_")))
  server = await connectStdio(env)
}, { timeout: TIMEOUT })

after(async () => {
  await server?.close()
})

const isWei = (s: unknown) => typeof s === "string" && /^\d+$/.test(s)

test("status over stdio", { skip, timeout: TIMEOUT }, async () => {
  const r = await server!.call("status")
  // A tool error is one sentence with no URL, so it is safe to show.
  assert.ok(!r.isError, JSON.stringify(r.content))
  const s = r.structuredContent as { totalStaked: { value: string }; merkleRoot: { match: boolean } }
  assert.ok(isWei(s.totalStaked.value) && BigInt(s.totalStaked.value) > 0n)
  assert.equal(typeof s.merkleRoot.match, "boolean")
  assert.match(r.content[0]?.type === "text" ? r.content[0].text : "", /^Safenet at Ethereum Mainnet block \d+/)
})

test("validators_list over stdio", { skip, timeout: TIMEOUT }, async () => {
  const r = await server!.call("validators_list", { all: true })
  assert.ok(!r.isError, JSON.stringify(r.content))
  const l = r.structuredContent as {
    filter: string; validators: { address: string; stake: string; participation: number | null }[]
  }
  assert.equal(l.filter, "all")
  assert.ok(l.validators.length > 0)
  for (const v of l.validators) {
    assert.ok(isWei(v.stake), v.address)
    // SEF has published a null rate for every validator since 2026-10-20.
    assert.ok(v.participation === null || (v.participation >= 0 && v.participation <= 1), v.address)
  }
})

test("the server's log names where the RPC comes from, and no URL", { skip, timeout: TIMEOUT }, () => {
  const log = server!.stderr()
  assert.match(log, /RPC from MAINNET_RPC_URL first, then the public list; writes off/)
  assert.doesNotMatch(log, /https?:\/\//)
})
