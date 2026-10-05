#!/usr/bin/env node
// Fails if anything reachable from the web app reads process.env, or if a built bundle contains
// a non-VITE_ value from .env.local. A private RPC URL in a browser bundle publishes the key.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve, join } from "node:path"

// BROWSER_SAFETY_ROOT points the check at another tree. Only its regression test sets it.
const ROOT = process.env.BROWSER_SAFETY_ROOT
  ? resolve(process.env.BROWSER_SAFETY_ROOT)
  : resolve(import.meta.dirname, "..")
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

// 2. build: no secret from .env.local may appear in dist. VITE_ values are skipped: Vite puts
// every one of them into the bundle by design, so they are public by definition.
const envPath = join(ROOT, ".env.local")
const distDir = join(ROOT, "apps/web/dist/assets")
if (existsSync(envPath) && existsSync(distDir)) {
  const secrets = readFileSync(envPath, "utf8")
    .split("\n")
    .map((l) => {
      const [key, ...rest] = l.split("=")
      // `vercel env pull` quotes every value. Strip a leading and a trailing quote, matched or
      // not: what is left is a substring of the raw value, so comparing it covers both.
      const value = rest.join("=").trim().replace(/^["']/, "").replace(/["']$/, "")
      return { key: key.trim(), value }
    })
    .filter(({ key, value }) => !key.startsWith("VITE_") && value.length > 12)
  const bundle = readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(distDir, f), "utf8"))
    .join("\n")
  // Name each leaked key once, and never print its value.
  const leaked = new Set(secrets.filter(({ value }) => bundle.includes(value)).map(({ key }) => key))
  for (const key of leaked) {
    console.error(`The value of ${key} from .env.local appears in the built bundle. Do not deploy this.`)
    failed = true
  }
}

console.log(failed ? "browser safety: FAILED" : "browser safety: clean")
process.exit(failed ? 1 : 0)
