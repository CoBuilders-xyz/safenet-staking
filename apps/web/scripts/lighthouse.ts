#!/usr/bin/env tsx
/**
 * Lighthouse, mobile, against a built dist/, checked against the Lighthouse half of
 * performance-budget.json. It serves dist/ with `vite preview` on loopback, runs Lighthouse
 * `runs` times per route with its default mobile settings (a mid-range phone on slow 4G,
 * simulated), and compares the median of each score and metric with the budget.
 *
 *   pnpm --filter @cobuilders/safenet-web release:build
 *   pnpm --filter @cobuilders/safenet-web budget:lighthouse
 *
 * Chrome comes from CHROME_PATH, else Playwright's Chromium. The page reads the real chain,
 * subgraphs and SEF's files, so a run needs the network, and the numbers move a little between
 * runs; that is why the median is compared.
 */
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"
import { formatVerdicts, median, readBudget, type Verdict } from "./budget"

const LIGHTHOUSE = "lighthouse@13.6.0"
const APP = resolve(import.meta.dirname, "..")
const PORT = Number(process.env.LIGHTHOUSE_PORT ?? 4180)
const origin = `http://127.0.0.1:${PORT}`
const budget = readBudget(join(APP, "performance-budget.json")).lighthouse
const chromePath = process.env.CHROME_PATH ?? chromium.executablePath()

const server = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  cwd: APP,
  stdio: "ignore",
})
const stop = () => server.kill("SIGTERM")
process.on("exit", stop)

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`vite preview did not answer on ${origin}`)
}

interface Run {
  scores: Record<string, number>
  metrics: Record<string, number>
}

function lighthouse(url: string, out: string): Run {
  execFileSync(
    "pnpm",
    [
      "dlx", LIGHTHOUSE, url,
      "--form-factor=mobile",
      `--only-categories=${Object.keys(budget.minScores).join(",")}`,
      "--output=json", `--output-path=${out}`,
      "--chrome-flags=--headless=new", "--quiet",
    ],
    { env: { ...process.env, CHROME_PATH: chromePath }, stdio: "ignore" },
  )
  const report = JSON.parse(readFileSync(out, "utf8")) as {
    categories: Record<string, { score: number }>
    audits: Record<string, { numericValue?: number }>
  }
  return {
    scores: Object.fromEntries(Object.entries(report.categories).map(([k, v]) => [k, Math.round(v.score * 100)])),
    metrics: Object.fromEntries(Object.keys(budget.maxMetrics).map((k) => [k, report.audits[k]?.numericValue ?? Number.NaN])),
  }
}

await waitForServer()
const dir = mkdtempSync(join(tmpdir(), "lighthouse-"))
let failed = false
try {
  for (const route of budget.routes) {
    const runs = Array.from({ length: budget.runs }, (_, i) => lighthouse(`${origin}/${route.replace(/^\//, "")}`, join(dir, `${i}.json`)))
    const verdicts: Verdict[] = [
      ...Object.entries(budget.minScores).map(([name, limit]) => {
        const measured = median(runs.map((r) => r.scores[name] ?? 0))
        return { name: `${name} score (min)`, measured, limit, unit: "", ok: measured >= limit }
      }),
      ...Object.entries(budget.maxMetrics).map(([name, limit]) => {
        const measured = median(runs.map((r) => r.metrics[name] ?? Number.NaN))
        return { name, measured, limit, unit: name === "cumulative-layout-shift" ? "" : "ms", ok: measured <= limit }
      }),
    ]
    console.log(`lighthouse: ${route}, median of ${budget.runs} mobile runs\n${formatVerdicts(verdicts)}`)
    failed ||= verdicts.some((v) => !v.ok)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
  stop()
}
if (failed) {
  console.error("lighthouse: over budget. See PERFORMANCE.md before raising a limit.")
  process.exit(1)
}
