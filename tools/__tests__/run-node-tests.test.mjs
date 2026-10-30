// Runs run-node-tests.mjs in coverage mode against a scratch package, so the threshold, the
// guard against a source file no test loads, and --skip are each shown to fail when they should.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const SCRIPT = resolve(import.meta.dirname, "../run-node-tests.mjs")
// The runner imports tsx, which Node resolves from the working directory up. A scratch tree
// under the repository's node_modules finds the repository's copy.
const SCRATCH = resolve(import.meta.dirname, "../../node_modules/.cache")

const half = `export function used(n: number): number {\n  return n + 1\n}\n\nexport function unused(n: number): number {\n  const a = n * 2\n  const b = a * 2\n  const c = b * 2\n  return c\n}\n`
const whole = `export const add = (a: number, b: number): number => a + b\n`
const testOf = (module, call) =>
  `import { test } from "node:test"\nimport assert from "node:assert/strict"\nimport * as m from "./${module}.ts"\ntest("${module}", () => assert.ok(${call}))\n`

/** Writes `files` into a fresh package directory and runs the runner there with `args`. */
function run(files, args) {
  mkdirSync(SCRATCH, { recursive: true })
  const root = mkdtempSync(join(SCRATCH, "run-node-tests-"))
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), body)
    }
    // NODE_TEST_CONTEXT tells a nested runner it is inside this test, and it would then skip
    // its files.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: "utf8" })
    return { status: r.status, output: r.stdout + r.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const covered = {
  "src/add.ts": whole,
  "src/add.test.ts": testOf("add", "m.add(1, 2) === 3"),
}

test("coverage at or above the threshold passes", () => {
  const { status, output } = run(covered, ["--coverage-lines=80", "src"])
  assert.equal(status, 0, output)
  assert.match(output, /start of coverage report/)
})

test("coverage below the threshold fails", () => {
  const files = { "src/half.ts": half, "src/half.test.ts": testOf("half", "m.used(1) === 2") }
  const { status, output } = run(files, ["--coverage-lines=95", "src"])
  assert.equal(status, 1, output)
  assert.match(output, /does not meet threshold/)
})

test("a source file no test loads fails the run and is named", () => {
  const { status, output } = run({ ...covered, "src/entry.ts": whole }, ["--coverage-lines=80", "src"])
  assert.equal(status, 1, output)
  assert.match(output, /no test loads src\/entry\.ts/)
})

test("a file named with --unmeasured is left out on purpose", () => {
  const files = { ...covered, "src/entry.ts": whole }
  const { status, output } = run(files, ["--unmeasured=src/entry.ts", "--coverage-lines=80", "src"])
  assert.equal(status, 0, output)
  assert.doesNotMatch(output, /entry\.ts/)
})

test("--skip runs no test and measures no file under the directory", () => {
  const files = {
    ...covered,
    "src/smoke/net.ts": whole,
    "src/smoke/net.test.ts": `import { test } from "node:test"\ntest("net", () => { throw new Error("ran") })\n`,
  }
  const { status, output } = run(files, ["--skip=src/smoke", "--coverage-lines=80", "src"])
  assert.equal(status, 0, output)
  assert.doesNotMatch(output, /net\.ts/)
})

test("an unknown option is a usage error", () => {
  const { status, output } = run(covered, ["--coverage=80", "src"])
  assert.equal(status, 2)
  assert.match(output, /unknown option --coverage=80/)
})
