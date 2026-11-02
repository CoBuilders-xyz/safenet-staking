import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Execute the workflow's actual planning shell only. Never run pack, check or publish jobs.
const workflow = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/publish.yml"), "utf8")
const planJob = workflow.split("\n  plan:\n")[1]?.split("\n  pack:\n")[0]
const block = planJob?.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1]
assert.ok(block, "publish workflow must contain its plan shell")
const script = block.replace(/^ {10}/gm, "")

function plan(settings) {
  const dir = mkdtempSync(join(tmpdir(), "publish-plan-"))
  try {
    const output = join(dir, "output")
    const summary = join(dir, "summary")
    writeFileSync(output, "")
    writeFileSync(summary, "")
    const run = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      env: {
        PATH: "/usr/bin:/bin", EVENT: "push", REF: "refs/tags/cli-v1.2.3", REF_NAME: "cli-v1.2.3",
        INPUT_PACKAGE: "", INPUT_PUBLISH: "", PRIVATE: "false", ...settings,
        GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
      },
      encoding: "utf8", timeout: 5_000,
    })
    return { ...run, outputs: readFileSync(output, "utf8"), summary: readFileSync(summary, "utf8") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const pkg of ["cli", "mcp"]) {
  test(`${pkg} tag with no version fails before producing publish outputs`, () => {
    const result = plan({ REF: `refs/tags/${pkg}-v`, REF_NAME: `${pkg}-v` })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /tag must include a version/)
    assert.equal(result.outputs, "")
    assert.equal(result.summary, "")
  })

  test(`${pkg} version tag preserves its package and version`, () => {
    const result = plan({ REF: `refs/tags/${pkg}-v1.2.3`, REF_NAME: `${pkg}-v1.2.3` })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.outputs, `packages=["${pkg}"]\npublish=true\ntag-version=1.2.3\n`)
  })

  test(`${pkg} dispatch with publish off remains available on a private feature branch`, () => {
    const result = plan({
      EVENT: "workflow_dispatch", REF: "refs/heads/feature", REF_NAME: "feature",
      INPUT_PACKAGE: pkg, INPUT_PUBLISH: "false", PRIVATE: "true",
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.outputs, `packages=["${pkg}"]\npublish=false\ntag-version=\n`)
    assert.match(result.summary, /nothing is published/)
  })
}

test("private repositories refuse publishing provenance, but not branch dry runs", () => {
  const result = plan({ PRIVATE: "true" })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /private repository/)
  assert.equal(result.outputs, "")
})

test("publishing dispatch remains restricted to main", () => {
  const result = plan({ EVENT: "workflow_dispatch", REF: "refs/heads/feature", INPUT_PACKAGE: "cli", INPUT_PUBLISH: "true" })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /publishes from main only/)
})
