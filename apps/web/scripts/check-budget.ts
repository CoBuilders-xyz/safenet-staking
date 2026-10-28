#!/usr/bin/env tsx
/**
 * Check a built dist/ against the bundle half of performance-budget.json. `release:build` runs
 * it after the build, so a release over budget fails; run it alone after any build:
 *
 *   pnpm --filter @cobuilders/safenet-web budget:bundle
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { checkBundle, formatVerdicts, measureBundle, readBudget } from "./budget"

const APP = resolve(import.meta.dirname, "..")
const DIST = join(APP, "dist")
if (!existsSync(join(DIST, "index.html"))) {
  console.error("budget: no dist/index.html. Build first: pnpm --filter @cobuilders/safenet-web build")
  process.exit(1)
}
const verdicts = checkBundle(measureBundle(DIST), readBudget(join(APP, "performance-budget.json")).bundle)
console.log(`budget: bundle\n${formatVerdicts(verdicts)}`)
if (verdicts.some((v) => !v.ok)) {
  console.error("budget: the bundle is over budget. See PERFORMANCE.md before raising a limit.")
  process.exit(1)
}
