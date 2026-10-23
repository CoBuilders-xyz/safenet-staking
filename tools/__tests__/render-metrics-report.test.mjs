// Runs render-metrics-report.mjs against a scratch tree with a hand-built run, so the report's
// participation table is checked without an archive node.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(import.meta.dirname, "../render-metrics-report.mjs")

/** Writes a run with these participation rows, renders it, and returns the report. */
function render(participation) {
  const root = mkdtempSync(join(tmpdir(), "metrics-report-"))
  try {
    const dir = join(root, "packages/core/.metrics")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "metrics-poc-run.json"), JSON.stringify({
      runAt: new Date().toISOString(), mainnetBlock: "1", gnosisBlock: "1", windowDays: 14,
      gnosisBlockTime: 5, rows: [], participation, ceremonies: { all: 100, attestations: 100 },
    }))
    const run = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, METRICS_ROOT: root }, encoding: "utf8" })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    return readFileSync(join(dir, "metrics-poc-results.md"), "utf8")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a rate SEF publishes as null reads not published, with no gap", () => {
  const md = render([
    { label: "Alpha", ours: 0.99, sef: null, rounds: 99, absences: 1 },
    { label: "Bravo", ours: 1, sef: null, rounds: 100, absences: 0 },
  ])
  assert.match(md, /\| Alpha \| `0\.99` \| not published \| not compared \| 1 \|/)
  assert.doesNotMatch(md, /off by/)
})

test("a published rate is still compared to the bit", () => {
  const md = render([
    { label: "Alpha", ours: 0.99, sef: 0.99, rounds: 99, absences: 1 },
    { label: "Bravo", ours: 1, sef: 0.98, rounds: 100, absences: 0 },
  ])
  assert.match(md, /\| Alpha \| `0\.99` \| `0\.99` \| \*\*identical\*\* \|/)
  assert.match(md, /\| Bravo \| `1` \| `0\.98` \| off by 2\.00e\+0 pp \|/)
})
