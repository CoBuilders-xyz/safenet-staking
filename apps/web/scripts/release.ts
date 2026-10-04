#!/usr/bin/env tsx
/**
 * Build the production bundle and pack it into a CAR whose root CID anyone can reproduce.
 *
 *   1. Read build.env. It is the only input besides the source and the lockfile: every .env
 *      file and every VITE_ variable already in the shell is ignored.
 *   2. `vite build --mode production` into dist/.
 *   3. tools/check-browser-safety.mjs over dist/. A secret in the bundle fails the release.
 *   4. Pack dist/ into release/app.car and write the root CID to release/CID.
 *
 * CID settings are ipfs-car 3.1.0's defaults, which are also the web3.storage defaults:
 * CIDv1, raw leaves, 1 MiB fixed-size chunks, balanced layout 1024 links wide, UnixFS
 * directories sharded only above 1000 entries, no mtime and no mode. The CAR is what gets
 * pinned, so the provider stores this DAG as built here and does not re-chunk the files.
 * `npx ipfs-car@3.1.0 pack dist` on the same dist/ gives the same CID.
 *
 * Usage: pnpm --filter @cobuilders/safenet-web release:build
 */
import { execFileSync } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { parseEnv } from "node:util"
import * as UnixFS from "@ipld/unixfs"
import { withMaxChunkSize } from "@ipld/unixfs/file/chunker/fixed"
import { withWidth } from "@ipld/unixfs/file/layout/balanced"
import { CAREncoderStream, createDirectoryEncoderStream, type Block, type FileLike } from "ipfs-car"
import * as raw from "multiformats/codecs/raw"
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

// --- 1. Environment: build.env and nothing else ---
const publicEnv = parseEnv(readFileSync(BUILD_ENV, "utf8"))
for (const key of Object.keys(publicEnv)) {
  if (!key.startsWith("VITE_")) {
    fail(`build.env holds ${key}. Only VITE_ keys belong there: the file is public and only Vite reads it.`)
  }
}
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VITE_")) delete process.env[key]
}
Object.assign(process.env, publicEnv)
// Vite keeps a NODE_ENV already set in the shell, and NODE_ENV=development changes the bundle.
process.env.NODE_ENV = "production"

// --- 2. Build ---
rmSync(DIST, { recursive: true, force: true })
rmSync(RELEASE, { recursive: true, force: true })
console.log(`release: building with ${Object.keys(publicEnv).join(", ") || "no VITE_ value"} from build.env`)
// envDir: false stops Vite from reading .env, .env.local and .env.production in apps/web.
await build({ root: APP, mode: "production", envDir: false, logLevel: "warn" })
if (!existsSync(join(DIST, "index.html"))) fail("the build wrote no dist/index.html")

// --- 3. No secret in the bundle ---
try {
  execFileSync(process.execPath, [join(REPO, "tools/check-browser-safety.mjs")], { stdio: "inherit" })
} catch {
  fail("the browser-safety check failed. Do not publish this build.")
}

// --- 4. CAR and CID ---
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(DIST, join(entry.parentPath, entry.name)).split(sep).join("/"))
}

// Byte order, not locale order, so every machine walks the files the same way.
const paths = listFiles(DIST).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
// ipfs-car's CLI skips dot-files by default. Refuse them rather than ship a DAG it would not rebuild.
const hidden = paths.filter((p) => p.split("/").some((part) => part.startsWith(".")))
if (hidden.length) fail(`dist/ holds dot-files, which the CID check would not cover: ${hidden.join(", ")}`)

const files: FileLike[] = paths.map((name) => ({
  name,
  stream: () => Readable.toWeb(createReadStream(join(DIST, name))) as ReadableStream,
}))

// Collect the blocks first: the root is the last block, and the CAR header names the root.
const blocks: Block[] = []
// ipfs-car 3.1.0's defaults, written out so an ipfs-car upgrade cannot change the CID silently.
const settings = UnixFS.configure({
  fileChunkEncoder: raw,
  smallFileEncoder: raw,
  chunker: withMaxChunkSize(1024 * 1024),
  fileLayout: withWidth(1024),
})
await createDirectoryEncoderStream(files, settings).pipeTo(
  new WritableStream<Block>({ write: (block) => void blocks.push(block) }),
)
const root = blocks.at(-1)?.cid
if (!root) fail("packing dist/ produced no block")

const chunks: Uint8Array[] = []
await new ReadableStream<Block>({
  start(controller) {
    for (const block of blocks) controller.enqueue(block)
    controller.close()
  },
})
  .pipeThrough(new CAREncoderStream([root]))
  .pipeTo(new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) }))

mkdirSync(RELEASE, { recursive: true })
writeFileSync(join(RELEASE, "app.car"), Buffer.concat(chunks))
writeFileSync(join(RELEASE, "CID"), `${root.toString()}\n`)

console.log(`release: ${paths.length} files, ${blocks.length} blocks`)
console.log(`release: CID ${root.toString()}`)
