// Guards the suites that do not exist yet.
//
// `turbo run test:e2e` with no package implementing test:e2e prints "1 successful, 1 total"
// and exits 0. A green tick over a suite that does not exist is worse than a red one:
// a failure gets fixed, a false pass gets believed. This makes the absence loud.
//
// The workspace root is excluded on purpose: its own test:e2e script is this guard, and
// counting it would make the check pass by finding itself.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const [task, where] = process.argv.slice(2)
const root = resolve(process.env.INIT_CWD ?? process.cwd())

const owners = JSON.parse(
  execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], { encoding: "utf8" }),
).filter((p) => {
  if (resolve(p.path) === root) return false
  try {
    return !!JSON.parse(readFileSync(resolve(p.path, "package.json"), "utf8")).scripts?.[task]
  } catch {
    return false
  }
})

if (owners.length === 0) {
  console.error(`\n  ${task}: no package implements it yet. Expected in ${where}.`)
  console.error(`  Not reporting a pass for a suite that does not exist.\n`)
  process.exit(1)
}
console.error(`  ${task}: ${owners.map((p) => p.name).join(", ")}`)
