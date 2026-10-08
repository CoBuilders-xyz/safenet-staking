/**
 * One smoke test per command, against Ethereum Mainnet, through the real entry point.
 *
 * Gated on MAINNET_RPC_URL. Without it every test is skipped and says why, so a run without the
 * secret reports skips rather than passes. The scans these commands make cover a million blocks
 * and more, which public endpoints throttle, so a run without an archive endpoint would fail for
 * reasons that have nothing to do with this code.
 *
 *   pnpm --filter @cobuilders/safenet-cli test:smoke     reads MAINNET_RPC_URL from .env.local
 *
 * Turborepo's strict environment mode hides MAINNET_RPC_URL from `pnpm test`, so the root test
 * run always skips these. The nightly workflow runs them with the secret.
 */
import { before, test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { CONTRACTS, indexedEvent } from "@cobuilders/safenet-core"
import { createContext, scanLogs } from "../lib/index.js"

const skip = process.env.MAINNET_RPC_URL
  ? false
  : "MAINNET_RPC_URL is not set. These read Mainnet; run `pnpm --filter @cobuilders/safenet-cli test:smoke` with it"
const TIMEOUT = 180_000
const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url))

interface Result { code: number | null; stdout: string; stderr: string }

function safenet(...args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], { env: process.env })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

/** Runs a command with --json, asserts it exited 0, and parses its output. */
async function json<T>(...args: string[]): Promise<T> {
  const r = await safenet(...args, "--json")
  // stderr carries one sentence on failure and never a URL, so it is safe to show.
  assert.equal(r.code, 0, `safenet ${args.join(" ")} exited ${r.code}: ${r.stderr}`)
  return JSON.parse(r.stdout) as T
}

const isWei = (s: unknown) => typeof s === "string" && /^\d+$/.test(s)

// An address that has claimed rewards, found on chain rather than typed: the most recent
// claimant. Reward and withdrawal commands run against it.
let claimant: string

before(async () => {
  if (skip) return
  const ctx = createContext({})
  const latest = await ctx.client.getBlockNumber()
  const logs = await scanLogs(ctx, {
    address: CONTRACTS.merkleDrop.address,
    event: indexedEvent("merkleDrop", "Claimed"),
    fromBlock: CONTRACTS.merkleDrop.deployBlock,
    toBlock: latest,
  })
  const last = logs.at(-1)?.args.account
  assert.ok(last, "no Claimed log on Mainnet, so no claimant to test with")
  claimant = last
}, { timeout: TIMEOUT })

test("safenet status", { skip, timeout: TIMEOUT }, async () => {
  const s = await json<{
    totalStaked: { value: string }; rewardsAllocated: { value: string }; merkleRoot: { match: boolean }
    rewardsSource: { kind: string; ens: { status: string } }
  }>("status")
  assert.ok(isWei(s.totalStaked.value) && BigInt(s.totalStaked.value) > 0n)
  assert.ok(isWei(s.rewardsAllocated.value))
  assert.equal(typeof s.merkleRoot.match, "boolean")
  // The real Universal Resolver and resolver calls: "empty" on 2026-10-08, "set" once SEF
  // populates the name. "unreadable" or "unsupported" means the ENS read itself broke.
  assert.ok(["set", "empty"].includes(s.rewardsSource.ens.status), s.rewardsSource.ens.status)
  assert.ok(["ens", "repository"].includes(s.rewardsSource.kind), s.rewardsSource.kind)
  const text = await safenet("status")
  assert.equal(text.code, 0)
  assert.match(text.stdout, /Merkle root: (match|differs)\./)
})

test("safenet validators list", { skip, timeout: TIMEOUT }, async () => {
  const list = await json<{ window: { days: number }; validators: { address: string; participation: number | null; stake: string }[] }>(
    "validators", "list", "--all", "--sort", "participation",
  )
  assert.equal(list.window.days, 14)
  assert.ok(list.validators.length > 0)
  for (const v of list.validators) {
    assert.ok(isWei(v.stake))
    if (v.participation !== null) assert.ok(v.participation >= 0 && v.participation <= 1)
  }
})

test("safenet validators show", { skip, timeout: TIMEOUT }, async () => {
  const list = await json<{ validators: { address: string }[] }>("validators", "list")
  const first = list.validators[0]
  assert.ok(first, "SEF lists no active validator")
  const d = await json<{ validator: { registered: boolean }; delegators: { value: { current: number; ever: number } } }>(
    "validators", "show", first.address,
  )
  assert.equal(d.validator.registered, true)
  assert.ok(d.delegators.value.ever >= d.delegators.value.current)
})

test("safenet withdrawals list", { skip, timeout: TIMEOUT }, async () => {
  const w = await json<{ total: { value: string }; count: { value: number }; logsMatchChain: boolean }>("withdrawals", "list")
  assert.ok(isWei(w.total.value))
  // The logs and the contract are read at one block, so they must agree to the wei.
  assert.equal(w.logsMatchChain, true)
  const mine = await json<{ withdrawals: { value: unknown[] } }>("withdrawals", "list", "--address", claimant)
  assert.ok(Array.isArray(mine.withdrawals.value))
})

test("safenet rewards check", { skip, timeout: TIMEOUT }, async () => {
  const r = await json<{ earned: boolean; claimed: { value: string }; root: { status: string } | null }>(
    "rewards", "check", claimant,
  )
  assert.equal(r.earned, true, "an address that claimed must have a proof file")
  assert.ok(BigInt(r.claimed.value) > 0n)
  assert.ok(r.root && ["match", "stale proof"].includes(r.root.status))
})

test("safenet rewards history", { skip, timeout: TIMEOUT }, async () => {
  const h = await json<{ count: number; sumMatchesChain: boolean }>("rewards", "history", claimant, "--all")
  assert.ok(h.count > 0)
  // The claim amounts are increments, so they must sum to cumulativeClaimed on chain.
  assert.equal(h.sumMatchesChain, true)
})
