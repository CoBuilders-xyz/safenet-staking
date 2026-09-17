#!/usr/bin/env node
/**
 * PostToolUse hook. Runs after an agent edits a file (D-012, D-013).
 *
 *   lint   -> warns, the agent fixes it. Never blocks.
 *   types  -> blocks. A type error means the agent is building on a wrong assumption.
 *
 * Scoped to the edited file's package so it stays under a second. Turborepo caches,
 * so untouched packages never re-run. Nothing here touches the network.
 */
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")

let input = ""
try {
  input = readFileSync(0, "utf8")
} catch {
  process.exit(0)
}

let filePath
try {
  const payload = JSON.parse(input)
  filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.filePath
} catch {
  process.exit(0)
}
if (!filePath) process.exit(0)
if (!/\.(ts|tsx|mts|cts)$/.test(filePath)) process.exit(0)

// Walk up to the nearest package.json inside the workspace.
let dir = dirname(resolve(filePath))
let pkgDir = null
while (dir.startsWith(ROOT) && dir !== ROOT) {
  if (existsSync(resolve(dir, "package.json"))) { pkgDir = dir; break }
  dir = dirname(dir)
}
if (!pkgDir) process.exit(0)

const pkgName = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")).name
const where = relative(ROOT, pkgDir)

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: pkgDir, stdio: "pipe", encoding: "utf8" }) }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

// 1. Lint. Advisory only.
if (existsSync(resolve(pkgDir, "eslint.config.js"))) {
  const lint = run("npx --no-install eslint --fix " + JSON.stringify(relative(pkgDir, resolve(filePath))))
  if (!lint.ok) {
    console.error(`[lint] ${where}: issues remain after --fix. Please fix them.\n${lint.out.slice(0, 1500)}`)
    // exit 0 on purpose: lint warns, it does not block (D-012)
  }
}

// 2. Types. Blocking.
if (existsSync(resolve(pkgDir, "tsconfig.json"))) {
  const types = run("npx --no-install tsc --noEmit -p tsconfig.json")
  if (!types.ok) {
    console.error(
      `[types] ${pkgName} does not compile. Fix this before continuing; a type error usually means an assumption is wrong.\n\n${types.out.slice(0, 3000)}`,
    )
    process.exit(2) // blocks, and the agent sees the message
  }
}
process.exit(0)
