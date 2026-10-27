#!/usr/bin/env node
/**
 * Generates packages/core/.metrics/metrics-poc-results.md from the JSON the POC emits.
 * Both files are git-ignored: run `pnpm metrics` to produce them against live chains.
 * Nothing is retyped. A hand-copied report can turn a truncated string into a finding,
 * so the report is generated or it is not written.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

// METRICS_ROOT points the renderer at another tree. Only its regression test sets it.
const ROOT = process.env.METRICS_ROOT ? resolve(process.env.METRICS_ROOT) : resolve(import.meta.dirname, "..")

const OUT_DIR = resolve(ROOT, "packages/core/.metrics")
const RUN = resolve(OUT_DIR, "metrics-poc-run.json")
const REPORT = resolve(OUT_DIR, "metrics-poc-results.md")
const j = JSON.parse(readFileSync(RUN, "utf8"))

// Refuse to render a report from a stale run. If metrics-poc.ts throws, it never writes the JSON,
// and rendering the previous run would produce a document with a fresh timestamp and old contents.
const ageMin = (Date.now() - Date.parse(j.runAt)) / 60000
const MAX_AGE_MIN = Number(process.env.METRICS_MAX_AGE_MIN ?? 30)
if (!Number.isFinite(ageMin) || ageMin > MAX_AGE_MIN) {
  console.error(
    `refusing to render: metrics-poc-run.json is ${ageMin.toFixed(0)} minutes old (limit ${MAX_AGE_MIN}).\n` +
    `The metrics run probably failed without writing new output. Re-run \`pnpm metrics\` and read the\n` +
    `error, rather than publishing a report that looks fresh and is not.`,
  )
  process.exit(1)
}
const n = (v) => v.toLocaleString("en-US")
const counts = ["PROVEN", "PARTIAL", "BLOCKED"].map((v) => j.rows.filter((r) => r.verdict === v).length)

let md = `# Metrics proof of concept — results

<!-- GENERATED FILE. Do not edit by hand.
     Produced by: node tools/render-metrics-report.mjs
     From:        packages/core/.metrics/metrics-poc-run.json
     Which comes from: packages/core/scripts/metrics-poc.ts -->

**Run:** ${j.runAt.slice(0, 19).replace("T", " ")} UTC
**Mainnet block:** ${n(Number(j.mainnetBlock))} · **Gnosis block:** ${n(Number(j.gnosisBlock))}
**Window:** ${j.windowDays} days · **Measured Gnosis block time:** ${j.gnosisBlockTime.toFixed(3)}s

**${counts[0]} proven · ${counts[1]} partial · ${counts[2]} blocked, across ${j.rows.length} metrics.**

This script is the subgraph's mapping logic in scratch form. Every metric here becomes a handler.

---

## Results

| Metric | Value | Window | Verdict |
|---|---|---|---|
`
for (const r of j.rows) {
  md += `| **${r.metric}** | ${r.value} | ${r.window} | ${r.verdict} |\n`
}

md += `
> Share percentages are rounded to one decimal place. Participation rates are printed in full,
> because their exactness is the claim.

---

## Detail
`
let group = ""
for (const r of j.rows) {
  if (r.group !== group) { group = r.group; md += `\n### ${group}\n` }
  md += `\n**${r.metric}** — ${r.value}\n\n`
  md += `- Source: \`${r.source}\`\n- Window: ${r.window}\n- Verdict: **${r.verdict}**\n`
  if (r.note) md += `- ${r.note}\n`
}

md += `\n---\n\n## Participation, reproduced against SEF's published figures\n\n`
md += `Our computation of SEF's rolling 14-day formula, beside the numbers they publish.\n\n`
md += `| Validator | Ours | SEF published | Match | Absences |\n|---|---|---|---|---|\n`
for (const p of [...j.participation].sort((a, b) => b.ours - a.ours)) {
  // Show the raw doubles and say plainly whether they are the same value. A rounded
  // "0.000 pp" cannot distinguish exact from 0.0004 pp off, and exactness is the whole claim.
  // SEF can publish a null rate: then there is nothing to compare, and no gap to report.
  const match = p.sef === null
    ? "not compared"
    : p.ours === p.sef ? "**identical**" : `off by ${((p.ours - p.sef) * 100).toExponential(2)} pp`
  md += `| ${p.label} | \`${p.ours}\` | ${p.sef === null ? "not published" : `\`${p.sef}\``} | ${match} | ${n(p.absences)} |\n`
}
const spread = (Math.max(...j.participation.map((p) => p.ours)) - Math.min(...j.participation.map((p) => p.ours))) * 100
const worst = j.participation.reduce((a, b) => (a.absences > b.absences ? a : b))
const best = j.participation.reduce((a, b) => (a.absences < b.absences ? a : b))

// The conclusion is DERIVED, not asserted. A conclusion written as a string literal can
// contradict the numbers printed beside it: generating the file removes the risk of mis-copying
// numbers, not the risk of mis-copying conclusions.
const MATERIAL_SPREAD_PP = 1.0
const differentiates = spread >= MATERIAL_SPREAD_PP

md += `
Ceremonies in window: ${n(j.ceremonies.attestations)} transaction attestations of ${n(j.ceremonies.all)} total.

**${differentiates
  ? "Validator performance differentiates."
  : "Validator performance does NOT meaningfully differentiate on this run."}** The spread is ${spread.toFixed(2)} percentage points${differentiates ? "" : `, below the ${MATERIAL_SPREAD_PP.toFixed(1)} pp we treat as material`}.
${worst.label} missed ${n(worst.absences)} rounds; ${best.label} missed ${n(best.absences)}.
${best.absences < 10
  ? `We quote the two counts rather than their ratio: with a denominator of ${best.absences} a ratio is not a meaningful statistic.`
  : `That is a factor of ${(worst.absences / best.absences).toFixed(1)}.`}
`
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(REPORT, md)
console.log(`wrote packages/core/.metrics/metrics-poc-results.md — ${j.rows.length} metrics, ${counts[0]}/${counts[1]}/${counts[2]}`)
