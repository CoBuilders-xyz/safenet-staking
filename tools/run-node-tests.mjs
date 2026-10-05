#!/usr/bin/env node
// Runs node:test over every *.test.ts under one or more directories, and fails when there is none.
//
// `node --test src/**/*.test.ts` with no matching file prints "# tests 0" and exits 0, so a
// package with no tests reported a pass. Same reasoning as require-task.mjs: a green tick over
// a suite that does not exist gets believed.
//
//   node ../../tools/run-node-tests.mjs src
//   node ../../tools/run-node-tests.mjs src scripts
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const dirs = process.argv.length > 2 ? process.argv.slice(2) : ["src"]

const files = dirs
  .flatMap((dir) =>
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => join(dir, f)),
  )
  .sort()

if (files.length === 0) {
  console.error(`\n  test: no *.test.ts file under ${dirs.map((d) => join(process.cwd(), d)).join(", ")}.`)
  console.error(`  Not reporting a pass for a suite that does not exist.\n`)
  process.exit(1)
}

const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" })
process.exit(run.status ?? 1)
