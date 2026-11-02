import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Run the workflow's actual shell with a local tarball and a fake npm. No registry is contacted.
const workflow = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/publish.yml"), "utf8")
function step(name) {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1]
  assert.ok(block, `publish workflow must contain the ${name} shell`)
  return block.replace(/^ {10}/gm, "")
}

function fixture(version, run) {
  const dir = mkdtempSync(join(tmpdir(), "publish-tarball-"))
  try {
    mkdirSync(join(dir, "package"))
    writeFileSync(join(dir, "package/package.json"), JSON.stringify({ name: "@example/fixture", version }))
    mkdirSync(join(dir, "bin"))
    symlinkSync(process.execPath, join(dir, "bin/node"))
    const npm = join(dir, "bin/npm")
    writeFileSync(npm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$RUNNER_TEMP/publish-args"\n')
    chmodSync(npm, 0o755)
    const env = {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`, RUNNER_TEMP: dir,
      GITHUB_STEP_SUMMARY: join(dir, "summary"), PACKAGE: "cli", PUBLISH: "true", TAG_VERSION: "",
    }
    const shell = (script, overrides = {}) => spawnSync("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: dir, env: { ...env, ...overrides }, encoding: "utf8", timeout: 5_000,
    })
    return run({ dir, shell })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [version, tag] of [
  ["1.2.3", "latest"],
  ["1.2.3+build-with-dashes", "latest"],
  ["1.2.3-alpha.1", "alpha"],
  ["1.2.3-beta.2", "beta"],
  ["1.2.3-rc.1", "rc"],
  ["1.2.3-0", "0"],
  ["1.2.3-rc.1+build", "rc"],
  ["0.1.0-beta.0", "beta"],
  ["1.0.0-alpha.1", "alpha"],
  ["1.2.3-beta.0+build-with-dashes", "beta"],
]) {
  test(`passes the checked ${version} tarball with derived tag ${tag}`, () => fixture(version, ({ dir, shell }) => {
    mkdirSync(join(dir, "pack"))
    const tarball = join(dir, "pack/fixture.tgz")
    const pack = spawnSync("tar", ["-czf", tarball, "package"], { cwd: dir, encoding: "utf8" })
    assert.equal(pack.status, 0, pack.stderr)
    const result = shell(step("Publish"))
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(readFileSync(join(dir, "publish-args"), "utf8").trim().split("\n"), [
      "publish", tarball, "--provenance", "--access", "public", "--tag", tag,
    ])
  }))
}

for (const [version, publish, tagVersion, status] of [
  ["0.0.0", "true", "", 1],
  ["0.0.0", "false", "", 0],
  ["1.2.3-rc.1", "true", "1.2.3-rc.1", 0],
  ["1.2.3-rc.1", "true", "1.2.3", 1],
]) {
  test(`version gate: ${version}, publish=${publish}, tag=${tagVersion || "dispatch"}`, () => fixture(version, ({ dir, shell }) => {
    mkdirSync(join(dir, "packages/cli"), { recursive: true })
    writeFileSync(join(dir, "packages/cli/package.json"), JSON.stringify({ version }))
    const result = shell(step("Check the version"), { PUBLISH: publish, TAG_VERSION: tagVersion })
    assert.equal(result.status, status, result.stdout + result.stderr)
  }))
}

test("normal publish auth is OIDC only with a supported pinned npm", () => {
  const publishJob = workflow.split("\n  publish:\n")[1]
  assert.ok(publishJob)
  assert.match(publishJob, /id-token: write/)
  assert.doesNotMatch(publishJob, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN|registry-url:/)
  const version = publishJob.match(/npm install --global npm@(\d+)\.(\d+)\.(\d+)/)
  assert.ok(version, "pin the npm client that performs the OIDC exchange")
  const [, major, minor, patch] = version.map(Number)
  assert.ok(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))))
})
