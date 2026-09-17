#!/usr/bin/env node
// Builds the prototype's Gnosis snapshot from the metrics run. Reads structured figures only;
// never parses a display string.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
const ROOT = resolve(import.meta.dirname, "..")
const RUN = resolve(ROOT, "docs/internal/metrics-poc-run.json")
// docs/internal is gitignored, so a fresh clone does not have this. Say so, rather
// than dying on ENOENT and reading as a broken toolchain.
if (!existsSync(RUN)) {
  console.error("\n  No metrics run found at docs/internal/metrics-poc-run.json.")
  console.error("  Run `pnpm metrics` first: it queries both chains and writes it.\n")
  process.exit(1)
}
const j = JSON.parse(readFileSync(RUN, "utf8"))
if (!j.figures) {
  console.error("metrics-poc-run.json has no `figures` block. Re-run `pnpm metrics`.")
  process.exit(1)
}
const snap = {
  source: "packages/core/scripts/metrics-poc.ts",
  runAt: j.runAt,
  gnosisBlock: j.gnosisBlock,
  windowDays: j.windowDays,
  attestationsPerDay: j.figures.attestationsPerDay,
  attestationsPerDayRange: [j.figures.attestationsPerDayMin, j.figures.attestationsPerDayMax],
  latencyMedianBlocks: j.figures.latencyMedianBlocks,
  latencySeconds: j.figures.latencySeconds,
  ceremonies: j.ceremonies,
  participation: j.participation.map((p) => ({
    label: p.label, address: p.address, rate: p.ours, sef: p.sef, absences: p.absences,
  })),
}
writeFileSync(resolve(ROOT, "apps/web-proto/src/lib/gnosis-snapshot.json"), JSON.stringify(snap, null, 2))
console.log(`snapshot: ${snap.attestationsPerDay}/day, ${snap.participation.length} validators, run ${snap.runAt.slice(0, 16)}`)
