// The spec gate: every requirement has a passing test, and no test names an unknown one.
//
// NOT BUILT YET. It is listed here rather than left missing because `pnpm spec:check`
// used to die on a Node module-not-found stack trace, which reads like a broken
// toolchain instead of an unwritten one.
//
// It cannot do its job today for a simple reason: `openspec/` holds config.yaml and no
// changes, and the repo has no test files. A gate over an empty set passes vacuously,
// and a vacuous pass on a completeness check is the exact failure this project keeps
// hitting. So it refuses instead.
//
// Build it when the first OpenSpec change lands. It must: collect requirement IDs from
// openspec/changes/**, collect the IDs named by tests, and fail on either direction of
// mismatch.
import { existsSync, readdirSync } from "node:fs"

const changes = (existsSync("openspec/changes") ? readdirSync("openspec/changes") : [])
  .filter((d) => d !== "archive")
console.error(`
  spec:check is not built yet.

  openspec/changes: ${changes.length} change(s)
  test files:       0

  There is nothing to gate. Refusing rather than passing over an empty set.
  See tools/spec-check.mjs for what it has to do.
`)
process.exit(1)
