#!/usr/bin/env tsx
/**
 * Build today's snapshot directory: every figure read at one Mainnet block, one Gnosis block
 * and SEF's latest commits, checked, and written all at once under `<out>/<day>`.
 *
 * Nothing is pinned here; `snapshot:publish` does that. A figure that cannot be read, or two
 * sources that disagree at the same block, fail the run with one sentence, and no directory is
 * written for the day.
 *
 * Required environment:
 *   MAINNET_RPC_URL  an archive endpoint. The delegator counts and the withdrawal totals scan
 *                    logs from the staking contract's deploy block, which the public endpoints
 *                    in packages/core refuse.
 * Optional:
 *   GITHUB_TOKEN     raises the GitHub API limit for the three commit lookups. `gh auth token`
 *                    is used when it is unset.
 *
 * Usage: pnpm --filter @cobuilders/safenet-snapshots snapshot:build [--out <dir>]
 * The default output is packages/snapshots/out. The day's path is printed last.
 */
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  createContext, fetchValidatorsWithWindow, getStatus, networkWithdrawals, readQueue, showValidator,
} from "@cobuilders/safenet-cli/lib"
import { SUBGRAPH_ENDPOINTS } from "@cobuilders/safenet-core"
import { githubToken, lastSefCommit, querySubgraph } from "@cobuilders/safenet-core/parity"
import { collect } from "../dataset.js"
import { pinContext, pinFetch } from "../pinned.js"
import { choosePoints } from "../points.js"
import { writeDay } from "../write.js"
import { fail, output, run } from "./run.js"

const SCRIPT = "snapshot-build"

run(SCRIPT, async () => {
  const { values } = parseArgs({ options: { out: { type: "string" } } })
  const out = resolve(values.out ?? resolve(import.meta.dirname, "../../out"))

  const rpcUrl = process.env.MAINNET_RPC_URL?.trim()
  if (!rpcUrl) {
    fail(SCRIPT, "MAINNET_RPC_URL is empty. The snapshot scans logs from the staking contract's deploy block, " +
      "which needs an archive endpoint. Nothing was written")
  }
  const gh = githubToken()
  const ctx = createContext({ rpcUrl, githubToken: gh.token })
  const mainnet = (q: string) => querySubgraph("mainnet", SUBGRAPH_ENDPOINTS.mainnet, q)
  const gnosis = (q: string) => querySubgraph("gnosis", SUBGRAPH_ENDPOINTS.gnosis, q)

  const points = await choosePoints({
    mainnet,
    gnosis,
    rpc: {
      head: () => ctx.client.getBlockNumber(),
      block: async (n) => {
        const b = await ctx.client.getBlock({ blockNumber: n })
        return { hash: b.hash, timestamp: b.timestamp }
      },
    },
    lastCommit: (url) => lastSefCommit("mainnet", url, gh.token),
    now: new Date(),
  })
  console.log(`${SCRIPT}: ${points.day}, Mainnet block ${points.mainnet.block}, Gnosis block ${points.gnosis.block}`)
  for (const p of points.sef) console.log(`${SCRIPT}: SEF's ${p.path} at ${p.commit.slice(0, 7)}, ${p.publishedAt.toISOString()}`)

  const fetchPins = pinFetch(globalThis.fetch, points.sef)
  const server = process.env.GITHUB_SERVER_URL
  const dataset = await collect({
    ctx: pinContext(ctx, points.mainnet.block, fetchPins),
    cli: { getStatus, showValidator, fetchValidatorsWithWindow, networkWithdrawals, readQueue },
    mainnet,
    gnosis,
    points,
    sefFile: fetchPins.sefFile,
    build: {
      commit: process.env.GITHUB_SHA ?? null,
      run: server && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
    },
  })
  const dir = writeDay(dataset, out)
  const manifest = dataset.json["manifest.json"] as { files: string[]; checks: unknown[] }
  console.log(`${SCRIPT}: ${manifest.files.length + 1} files, ${manifest.checks.length} checks passed`)
  console.log(`${SCRIPT}: wrote ${dir}`)
  output("day", dataset.day)
  output("dir", dir)
})
