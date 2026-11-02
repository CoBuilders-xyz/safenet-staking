#!/usr/bin/env node
// Fails if anything reachable from the web app reads process.env, or if a built bundle contains
// a non-VITE_ value from .env.local. A private RPC URL in a browser bundle publishes the key.
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve, join } from "node:path"
import { parseEnv } from "node:util"

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

// 2. build: no secret from .env.local may appear anywhere in dist, index.html and every asset
// included. VITE_ values are skipped: Vite puts every one of them into the bundle by design, so
// they are public by definition. So is any value that apps/web/build.env holds under a VITE_ key:
// the release build ships those on purpose, whatever key .env.local stores the same value under.
// A non-VITE_ key in build.env breaks that file's own rule, so its value earns no exemption.
const envPath = join(ROOT, ".env.local")
const distDir = join(ROOT, "apps/web/dist")
const buildEnvPath = join(ROOT, "apps/web/build.env")
if (existsSync(envPath) && existsSync(distDir)) {
  // The release build reads build.env with parseEnv, so read it the same way here.
  const published = new Set(
    Object.entries(existsSync(buildEnvPath) ? parseEnv(readFileSync(buildEnvPath, "utf8")) : {})
      .filter(([key]) => key.startsWith("VITE_"))
      .map(([, value]) => value),
  )
  // release.ts passes its explicit public gateway key in the inherited environment.
  // Exempt only GRAPH_API_KEY, not another private credential accidentally reused here.
  const graphApiKey = process.env.VITE_GRAPH_API_KEY?.trim()
  const secrets = readFileSync(envPath, "utf8")
    .split("\n")
    .map((l) => {
      const [key, ...rest] = l.split("=")
      // `vercel env pull` quotes every value. Strip a leading and a trailing quote, matched or
      // not: what is left is a substring of the raw value, so comparing it covers both.
      const value = rest.join("=").trim().replace(/^["']/, "").replace(/["']$/, "")
      return { key: key.trim(), value }
    })
    .filter(({ key, value }) => !key.startsWith("VITE_") && value.length > 12 &&
      !published.has(value) && !(key === "GRAPH_API_KEY" && value === graphApiKey))
  // UTF-8, so a value with non-ASCII characters matches the bytes Vite wrote.
  const bundle = readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"))
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
