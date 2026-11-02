#!/usr/bin/env tsx
/**
 * Build the production bundle and pack it into a CAR whose root CID anyone can reproduce.
 *
 *   1. Read build.env. Together with VITE_GRAPH_API_KEY, it supplies the public build inputs. Every .env
 *      file, every other VITE_ variable in the shell and the graph-node port from .env.ports
 *      are ignored.
 *   2. `vite build --mode production` into dist/.
 *   3. tools/check-browser-safety.mjs over dist/. A secret in the bundle fails the release.
 *      Its bundle half compares dist/ with .env.local, which only a developer machine has: on
 *      the CI runner it finds nothing to compare. There the guarantee is that the build job
 *      receives only the explicitly public Graph browser key (COB-566).
 *   3b. scripts/check-budget.ts: the bundle within performance-budget.json, or the release fails.
 *   4. Pack dist/ into release/app.car and write the root CID to release/CID.
 *
 * The packing is packDirectory in packages/snapshots, which the daily snapshots also use. Its
 * CID settings are ipfs-car 3.1.0's defaults, which are also the web3.storage defaults:
 * CIDv1, raw leaves, 1 MiB fixed-size chunks, balanced layout 1024 links wide, UnixFS
 * directories sharded only above 1000 entries, no mtime and no mode. The CAR is what gets
 * pinned, so the provider stores this DAG as built here and does not re-chunk the files.
 * `npx ipfs-car@3.1.0 pack dist` on the same dist/ gives the same CID.
 *
 * Usage: pnpm --filter @cobuilders/safenet-web release:build
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { releaseEnvironment } from "./release-env"
import { packDirectory, PackError, type Packed } from "@cobuilders/safenet-snapshots/ipfs"
import { build } from "vite"

const APP = resolve(import.meta.dirname, "..")
const REPO = resolve(APP, "../..")
const BUILD_ENV = join(APP, "build.env")
const DIST = join(APP, "dist")
const RELEASE = join(APP, "release")

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

// --- 1. Environment: build.env plus the explicit public gateway key ---
const publicEnv = releaseEnvironment(readFileSync(BUILD_ENV, "utf8"), process.env.VITE_GRAPH_API_KEY)
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VITE_")) delete process.env[key]
}
Object.assign(process.env, publicEnv)
// vite.config.ts inlines GRAPH_NODE_PORT, from the shell or else from the .env.ports that
// `pnpm bootstrap` writes per worktree, so a bootstrapped checkout would build another CID. An
// empty string wins over .env.ports in its `??` chain, and is what CI builds with.
process.env.GRAPH_NODE_PORT = ""
// Vite keeps a NODE_ENV already set in the shell, and NODE_ENV=development changes the bundle.
process.env.NODE_ENV = "production"

// --- 2. Build ---
rmSync(DIST, { recursive: true, force: true })
rmSync(RELEASE, { recursive: true, force: true })
console.log(`release: building with ${Object.keys(publicEnv).join(", ") || "no VITE_ value"} from release inputs`)
// envDir: false stops Vite from reading .env, .env.local and .env.production in apps/web.
await build({ root: APP, mode: "production", envDir: false, logLevel: "warn" })
if (!existsSync(join(DIST, "index.html"))) fail("the build wrote no dist/index.html")

// --- 3. Check known private values against the bundle ---
// The child inherits publicEnv, including VITE_GRAPH_API_KEY, for its public-value exemption.
try {
  execFileSync(process.execPath, [join(REPO, "tools/check-browser-safety.mjs")], { stdio: "inherit" })
} catch {
  fail("the browser-safety check failed. Do not publish this build.")
}

// --- 3b. Within the performance budget ---
try {
  execFileSync(process.execPath, ["--import", "tsx", join(APP, "scripts/check-budget.ts")], { stdio: "inherit" })
} catch {
  fail("the bundle is over the performance budget in performance-budget.json.")
}

// --- 4. CAR and CID ---
let packed: Packed
try {
  packed = await packDirectory(DIST)
} catch (err) {
  // A dot-file, which ipfs-car's CLI skips by default: refuse it rather than ship a DAG it would not rebuild.
  if (err instanceof PackError) fail(`dist/ holds ${err.message}`)
  throw err
}

mkdirSync(RELEASE, { recursive: true })
writeFileSync(join(RELEASE, "app.car"), packed.car)
writeFileSync(join(RELEASE, "CID"), `${packed.cid}\n`)

console.log(`release: ${packed.files.length} files, ${packed.blocks} blocks`)
console.log(`release: CID ${packed.cid}`)
