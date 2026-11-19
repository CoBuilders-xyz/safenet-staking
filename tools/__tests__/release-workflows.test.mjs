import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// The release workflow, read from its text.
function jobs(file) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows", file), "utf8")
  const body = text.split("\njobs:\n")[1]
  assert.ok(body, `${file} has a jobs section`)
  const out = {}
  for (const part of body.split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)) {
    const name = part.match(/^ {2}([a-z][a-z0-9-]*):\n/)?.[1]
    if (name) out[name] = part
  }
  return out
}

test("the Vercel upload runs from the repository root, where the Root Directory apps/web exists", () => {
  const step = jobs("release.yml").publish.split("- name: Upload to Vercel without the production domain")[1]?.split("\n      - ")[0]
  assert.ok(step, "release.yml has the Vercel upload step")
  assert.doesNotMatch(step, /\bcd\b|working-directory:/)
  // No default working directory at workflow or job scope moves it either.
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/release.yml"), "utf8")
  assert.doesNotMatch(text, /^\s*defaults:/m)
  assert.match(step, /cp -R apps\/web\/dist\/\. \.vercel\/output\/static\//)
  assert.match(step, /deploy --prebuilt --prod --skip-domain/)
})

// The promote step's shell, run against a fake curl that answers from a table and logs each call.
function promote(answers) {
  const job = jobs("release.yml").publish
  const step = job.split("- name: Give the Vercel deployment the production domain")[1]?.split("\n      - ")[0]
  const script = step?.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1]?.replace(/^ {10}/gm, "")
  assert.ok(script, "release.yml has the promote step")
  const dir = mkdtempSync(join(tmpdir(), "release-promote-"))
  try {
    const curl = join(dir, "curl")
    writeFileSync(curl, `#!/bin/bash
out=""; for ((i=1; i<=$#; i++)); do [ "\${!i}" = -o ] && { j=$((i+1)); out="\${!j}"; }; done
url="\${!#}"; echo "$url" >> "${dir}/calls"
case "$url" in
  */v13/deployments/*) code=${answers.lookup[0]}; printf '%s' '${answers.lookup[1]}' > "$out" ;;
  */promote/*) code=${answers.promote[0]}; printf '%s' '${answers.promote[1]}' > "$out" ;;
esac
printf '%s' "$code"
`)
    chmodSync(curl, 0o755)
    const run = spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      env: {
        PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, "summary"),
        VERCEL_TOKEN: "fixture", DEPLOYMENT: "https://app-abc.vercel.app", VERCEL_ORG_ID: "team_x", VERCEL_PROJECT_ID: "prj_y",
      },
      encoding: "utf8", timeout: 5_000,
    })
    let calls = []
    try { calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n") } catch { /* no call */ }
    return { status: run.status, out: run.stdout + run.stderr, calls }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("the promotion goes through Vercel's API, scoped to the team", () => {
  const r = promote({ lookup: [200, '{"id":"dpl_1"}'], promote: [201, "{}"] })
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(r.calls, [
    "https://api.vercel.com/v13/deployments/app-abc.vercel.app?teamId=team_x",
    "https://api.vercel.com/v10/projects/prj_y/promote/dpl_1?teamId=team_x",
  ])
})

test("a deployment the token cannot see stops before anything moves", () => {
  const r = promote({ lookup: [404, '{"error":{"message":"User not found."}}'], promote: [201, "{}"] })
  assert.equal(r.status, 1)
  assert.match(r.out, /Vercel did not find .* \(HTTP 404\): User not found\./)
  assert.equal(r.calls.length, 1)
})

test("a refused promotion fails the step with Vercel's reason", () => {
  const r = promote({ lookup: [200, '{"id":"dpl_1"}'], promote: [403, '{"error":{"message":"Forbidden"}}'] })
  assert.equal(r.status, 1)
  assert.match(r.out, /Vercel did not promote dpl_1 \(HTTP 403\): Forbidden/)
})
