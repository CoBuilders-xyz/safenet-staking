#!/usr/bin/env tsx
/**
 * Is the interface up, where people open it, and are the services it reads up?
 *
 * 1. The production deployment at PRODUCTION_URL answers with the title in `index.html`, and
 *    serves the entry script its index names.
 * 2. The ENS name in core, through eth.limo, answers with the same title, names its root CID in
 *    `x-ipfs-roots`, and serves the same `index.html` as production, byte for byte.
 * 3. Each gateway in IPFS_GATEWAYS from packages/core serves `index.html` of that CID, the one
 *    the ENS name serves, with the same title. The CID comes from production, not from a record
 *    in the repository, so a release cannot leave the check on an old one.
 * 4. The validator API answers `/v1/health` with status "ok" and a non-empty validator list.
 * 5. The alerts Worker answers `/health` with healthy true.
 *
 * Every target is checked to the end and printed before the run fails. With GITHUB_STEP_SUMMARY
 * set, the table also goes to the job summary. An Orbitor HTTP 504 is a warning only when every
 * other check passes. Exits 1 for any other failed check, or when a URL below is unset.
 *
 * Required, each deployment configuration, never a constant in the tree:
 *   PRODUCTION_URL      the URL of the production deployment
 *   VALIDATOR_INFO_URL  the validator API's list, `<origin>/v1/validators`
 *   ALERTS_API_URL      the alerts Worker's origin
 *
 * Usage: PRODUCTION_URL=… VALIDATOR_INFO_URL=… ALERTS_API_URL=… pnpm --filter @cobuilders/safenet-web availability
 */
import { appendFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { IPFS_GATEWAYS, WEB_ENS_NAME } from "@cobuilders/safenet-core"
import {
  annotation,
  applyAvailabilityPolicy,
  checkAlerts,
  checkApi,
  checkEns,
  checkGateway,
  checkProduction,
  ensOrigin,
  pageTitle,
  summary,
  type Outcome,
} from "./availability-checks"

function fail(message: string): never {
  console.error(`availability: ${message}`)
  process.exit(1)
}

const urls = {
  PRODUCTION_URL: process.env.PRODUCTION_URL?.trim(),
  VALIDATOR_INFO_URL: process.env.VALIDATOR_INFO_URL?.trim(),
  ALERTS_API_URL: process.env.ALERTS_API_URL?.trim(),
}
const missing = Object.entries(urls).filter(([, value]) => !value).map(([name]) => name)
if (missing.length) fail(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. Export the URL of each service.`)
for (const [name, value] of Object.entries(urls)) {
  try {
    new URL(value!)
  } catch {
    fail(`${name} is not a URL: give the scheme too, such as https://.`)
  }
}
const productionUrl = urls.PRODUCTION_URL!

const title = pageTitle(readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8"))
if (!title) fail("apps/web/index.html has no <title> to expect.")

const [production, ens, api, alerts] = await Promise.all([
  checkProduction(fetch, productionUrl, title),
  checkEns(fetch, ensOrigin(WEB_ENS_NAME), productionUrl, title),
  checkApi(fetch, urls.VALIDATOR_INFO_URL!),
  checkAlerts(fetch, urls.ALERTS_API_URL!),
])
const { cid } = ens
const gateways = await Promise.all(
  IPFS_GATEWAYS.map((g): Promise<Outcome> | Outcome =>
    cid ? checkGateway(fetch, g, cid, title) : { target: g, ok: false, detail: "not checked: the ENS name served no CID" }),
)
const outcomes: Outcome[] = applyAvailabilityPolicy([...production, ...ens.outcomes, ...gateways, ...api, alerts])

for (const outcome of outcomes) {
  const { target, ok, detail } = outcome
  console.log(process.env.GITHUB_ACTIONS === "true" ? annotation(outcome) : `${ok ? "OK  " : outcome.advisory ? "WARN" : "FAIL"} ${target}: ${detail}`)
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(outcomes, cid))

const failed = outcomes.filter((o) => !o.ok && !o.advisory).length
if (failed) fail(`${failed} of ${outcomes.length} checks failed.`)
const warnings = outcomes.filter(o => o.advisory).length
console.log(`availability: ${outcomes.length - warnings} checks passed; ${warnings} non-blocking gateway warnings.`)
