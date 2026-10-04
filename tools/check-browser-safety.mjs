#!/usr/bin/env node
// Fails if anything reachable from the web app reads process.env, or if a built bundle contains
// a value from .env.local. A private RPC URL in a browser bundle publishes the key.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve, join } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
let failed = false

// 1. source: no process.env under the web app's src
const hits = execSync(
  `grep -rn "process\\.env" ${join(ROOT, "apps/web/src")} || true`,
  { encoding: "utf8" },
).trim()
if (hits) {
  console.error("the web app reads process.env. Browser code has no process:\n" + hits)
  failed = true
}

// 2. build: no secret from .env.local may appear in dist
const envPath = join(ROOT, ".env.local")
const distDir = join(ROOT, "apps/web/dist/assets")
if (existsSync(envPath) && existsSync(distDir)) {
  const secrets = readFileSync(envPath, "utf8")
    .split("\n")
    .map((l) => l.split("=").slice(1).join("=").trim())
    .filter((v) => v.length > 12)
  const bundle = readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(distDir, f), "utf8"))
    .join("\n")
  for (const s of secrets) {
    if (bundle.includes(s)) {
      console.error(`A value from .env.local appears in the built bundle. Do not deploy this.`)
      failed = true
    }
  }
}

console.log(failed ? "browser safety: FAILED" : "browser safety: clean")
process.exit(failed ? 1 : 0)
