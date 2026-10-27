#!/usr/bin/env node
// Runs node:test over every *.test.ts and *.test.mjs under one or more directories, and fails
// when there is none.
//
// `node --test src/**/*.test.ts` with no matching file prints "# tests 0" and exits 0, so a
// package with no tests reported a pass. Same reasoning as require-task.mjs: a green tick over
// a suite that does not exist gets believed.
//
//   node ../../tools/run-node-tests.mjs src
//   node ../../tools/run-node-tests.mjs src scripts
//
// Options, before the directories:
//
//   --skip=<dir>           run no test under <dir> and measure no source file there
//   --coverage-lines=<n>   measure line coverage of the *.ts source files under the directories,
//                          with Node's built-in coverage, and fail below n percent
//   --unmeasured=<file>    a source file no test loads, left out of the measurement on purpose
//
// Node's coverage reports only the files a test loads. A source file no test imports would be
// missing from the report, not counted as uncovered, so the total would still pass. So a source
// file absent from the report fails the run, unless the package names it with --unmeasured.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const option = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
const unknown = args.filter((a) => a.startsWith("--") && !/^--(skip|coverage-lines|unmeasured)=/.test(a))
if (unknown.length > 0) {
  console.error(`\n  test: unknown option ${unknown.join(", ")}.\n`)
  process.exit(2)
}

const positional = args.filter((a) => !a.startsWith("--"))
const dirs = positional.length > 0 ? positional : ["src"]
const skip = option("skip").map((d) => resolve(d))
const unmeasured = option("unmeasured").map((f) => resolve(f))
const coverageLines = option("coverage-lines").at(-1)
if (coverageLines !== undefined && !/^\d+(\.\d+)?$/.test(coverageLines)) {
  console.error(`\n  test: --coverage-lines takes a percentage.\n`)
  process.exit(2)
}

const skipped = (file) => skip.some((d) => resolve(file).startsWith(d + "/"))
const under = (dir, keep) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter(keep)
    .map((f) => join(dir, f))
    .filter((f) => !skipped(f))

const files = dirs.flatMap((dir) => under(dir, (f) => f.endsWith(".test.ts") || f.endsWith(".test.mjs"))).sort()

if (files.length === 0) {
  console.error(`\n  test: no *.test.ts or *.test.mjs file under ${dirs.map((d) => join(process.cwd(), d)).join(", ")}.`)
  console.error(`  Not reporting a pass for a suite that does not exist.\n`)
  process.exit(1)
}

if (coverageLines === undefined) {
  const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" })
  process.exit(run.status ?? 1)
}

// Source maps make the report name lines of the TypeScript source, not of tsx's output.
const isSource = (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("test-support.ts")
const measured = dirs.flatMap((dir) => under(dir, isSource)).map((f) => resolve(f))
const out = mkdtempSync(join(tmpdir(), "coverage-"))
const lcov = join(out, "lcov.info")
const run = spawnSync(
  process.execPath,
  [
    "--enable-source-maps",
    "--import", "tsx",
    "--test",
    "--experimental-test-coverage",
    `--test-coverage-lines=${coverageLines}`,
    ...dirs.map((d) => `--test-coverage-include=${relative(process.cwd(), resolve(d)) || "."}/**/*.ts`),
    "--test-coverage-exclude=**/*.test.ts",
    "--test-coverage-exclude=**/test-support.ts",
    ...skip.map((d) => `--test-coverage-exclude=${relative(process.cwd(), d)}/**`),
    ...unmeasured.map((f) => `--test-coverage-exclude=${relative(process.cwd(), f)}`),
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${lcov}`,
    ...files,
  ],
  { stdio: "inherit" },
)

// The directory goes before any exit: process.exit inside a try would skip its finally.
let report = null
try {
  report = readFileSync(lcov, "utf8")
} catch {
  // No report: the run itself failed before writing one, and said why.
}
rmSync(out, { recursive: true, force: true })
if (report === null) process.exit(run.status || 1)
const reported = new Set(report.split("\n").filter((l) => l.startsWith("SF:")).map((l) => resolve(l.slice(3))))
const missing = measured.filter((f) => !reported.has(f) && !unmeasured.includes(f))
if (missing.length > 0) {
  console.error(`\n  coverage: no test loads ${missing.map((f) => relative(process.cwd(), f)).join(", ")}.`)
  console.error(`  Node leaves such a file out of the total. Test it, or name it with --unmeasured=<file>.\n`)
  process.exit(1)
}
process.exit(run.status ?? 1)
