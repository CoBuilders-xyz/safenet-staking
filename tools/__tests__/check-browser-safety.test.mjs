// Runs check-browser-safety.mjs against a scratch tree, so its bundle half is exercised. CI has
// neither a .env.local nor a dist, so without this test that half never runs there.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(import.meta.dirname, "../check-browser-safety.mjs")

/** Writes .env.local and one bundle file into a fresh tree, runs the check there. */
function check(envLocal, bundle) {
  const root = mkdtempSync(join(tmpdir(), "browser-safety-"))
  try {
    mkdirSync(join(root, "apps/web/src"), { recursive: true })
    mkdirSync(join(root, "apps/web/dist/assets"), { recursive: true })
    writeFileSync(join(root, ".env.local"), envLocal)
    writeFileSync(join(root, "apps/web/dist/assets/index.js"), bundle)
    const run = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, BROWSER_SAFETY_ROOT: root },
      encoding: "utf8",
    })
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a double-quoted secret present bare in the bundle fails, naming the key only", () => {
  const { status, output } = check('SECRET="plantedvalue456"\n', "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
  assert.match(output, /The value of SECRET from \.env\.local appears/)
  assert.doesNotMatch(output, /plantedvalue456/)
})

test("the same secret absent from the bundle passes", () => {
  const { status } = check('SECRET="plantedvalue456"\n', "const a=1;\n")
  assert.equal(status, 0)
})

test("a VITE_ value present in the bundle passes, because Vite inlines it by design", () => {
  const { status } = check('VITE_X="public-value-0001"\n', 'const a="public-value-0001";\n')
  assert.equal(status, 0)
})

test("a single-quoted secret present in the bundle fails", () => {
  const { status } = check("SECRET='plantedvalue456'\n", "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
})

test("a secret with an unmatched quote present in the bundle fails", () => {
  const { status } = check('SECRET="plantedvalue456\n', "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
})

test("a value of 12 characters or fewer is ignored", () => {
  const { status } = check('SHORT="twelve-chars"\n', 'const s="twelve-chars";\n')
  assert.equal(status, 0)
})

test("two keys that leak are each named once", () => {
  const { status, output } = check(
    'ONE="plantedvalue456"\nTWO="plantedvalue789"\n',
    "plantedvalue456 plantedvalue456 plantedvalue789\n",
  )
  assert.equal(status, 1)
  assert.equal(output.match(/The value of ONE /g)?.length, 1)
  assert.equal(output.match(/The value of TWO /g)?.length, 1)
})
