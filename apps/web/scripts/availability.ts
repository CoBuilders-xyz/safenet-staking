#!/usr/bin/env tsx
/**
 * Is the interface up, where people open it?
 *
 * 1. The production deployment at PRODUCTION_URL answers with the title in `index.html`, and
 *    serves the entry script its index names.
 * 2. When `deployments.json` at the repository root records a release, each gateway in
 *    IPFS_GATEWAYS from packages/core serves `index.html` of the latest one, by `pinnedAt`, with
 *    the same title.
 *
 * Every target is checked to the end and printed before the run fails. With GITHUB_STEP_SUMMARY
 * set, the table also goes to the job summary. Exits 1 when any check fails, when PRODUCTION_URL
 * is unset, or when `deployments.json` exists and is malformed.
 *
 * Required: PRODUCTION_URL, the URL of the production deployment. It is deployment
 * configuration: a repository variable in GitHub Actions, never a constant in the tree.
 *
 * Usage: PRODUCTION_URL=… pnpm --filter @cobuilders/safenet-web availability
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { IPFS_GATEWAYS } from "@cobuilders/safenet-core"
import {
  checkGateway,
  checkProduction,
  latestDeployment,
  pageTitle,
  parseDeployments,
  summary,
  type Outcome,
} from "./availability-checks"

function fail(message: string): never {
  console.error(`availability: ${message}`)
  process.exit(1)
}

const productionUrl = process.env.PRODUCTION_URL?.trim()
if (!productionUrl) fail("PRODUCTION_URL is not set. Export the URL of the production deployment.")

const title = pageTitle(readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8"))
if (!title) fail("apps/web/index.html has no <title> to expect.")

const deploymentsPath = resolve(import.meta.dirname, "../../../deployments.json")
let release
try {
  release = existsSync(deploymentsPath) ? latestDeployment(parseDeployments(readFileSync(deploymentsPath, "utf8"))) : undefined
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const outcomes: Outcome[] = [
  ...(await checkProduction(fetch, productionUrl, title)),
  ...(release ? await Promise.all(IPFS_GATEWAYS.map((g) => checkGateway(fetch, g, release.cid, title))) : []),
]

for (const { target, ok, detail } of outcomes) console.log(`${ok ? "OK  " : "FAIL"} ${target}: ${detail}`)
if (!release) console.log("IPFS: not checked. No release is recorded in deployments.json.")
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(outcomes, release))

const failed = outcomes.filter((o) => !o.ok).length
if (failed) fail(`${failed} of ${outcomes.length} checks failed.`)
console.log(`availability: ${outcomes.length} checks passed.`)
