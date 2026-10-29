#!/usr/bin/env node
// Builds `safenet` as one executable file for the platform this runs on, with Node's single
// executable applications: the CLI and every dependency bundled into one CommonJS script, its
// blob injected into a copy of the Node binary running this script.
//
//   node scripts/build-binary.mjs                     writes binaries/safenet-<os>-<arch>[.exe]
//   node scripts/build-binary.mjs --verify-reproducible builds twice and compares final SHA256
//   node scripts/build-binary.mjs --bundle-only <dir>  writes only the bundle, <dir>/safenet.cjs,
//                                                      which the unit test runs with plain node
//
// So the binary carries the Node version that built it: CI builds with the one in .nvmrc. It
// needs nothing installed to run. On macOS the copy is signed ad hoc after the injection, because
// the injection breaks Node's own signature and Apple silicon refuses to run an unsigned binary.
// The binary is run once with --version before the script reports success.
import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { isBuiltin } from "node:module"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { inject } from "postject"
import { build } from "tsup"

const PACKAGE = resolve(import.meta.dirname, "..")
const { version } = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"))
// The fuse Node looks for to know a blob was injected; fixed by Node's documentation.
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

/** The CLI and every dependency in one CommonJS file: the binary can require only Node's own modules. */
async function bundle(dir) {
  await build({
    entry: { safenet: join(PACKAGE, "src/sea.ts") },
    format: ["cjs"],
    platform: "node",
    target: "node22",
    outDir: dir,
    outExtension: () => ({ js: ".cjs" }),
    noExternal: [/.*/],
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: false,
    silent: true,
    config: false,
    tsconfig: join(PACKAGE, "tsconfig.json"),
    metafile: true,
    esbuildPlugins: [{
      name: "ws-javascript-fallback",
      setup(builder) {
        // ws 7 predates WS_NO_* flags. Its guarded require catches this module's error and
        // selects the built-in JavaScript fallback. ws 8 follows the same contract.
        builder.onResolve({ filter: /^(bufferutil|utf-8-validate)$/ }, ({ path }) => ({
          path, namespace: "optional-ws-native",
        }))
        builder.onLoad({ filter: /.*/, namespace: "optional-ws-native" }, () => ({
          contents: 'throw new Error("Use the bundled WebSocket JavaScript implementation")',
          loader: "js",
        }))
      },
    }],
    esbuildOptions(options) {
      options.absWorkingDir = PACKAGE
      // ws has complete JavaScript implementations. Never load optional native addons from
      // outside a standalone executable, even when the build host has them installed.
      options.define = {
        "process.env.WS_NO_BUFFER_UTIL": '"1"',
        "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
      }
      options.minifySyntax = true
    },
  })
  const metadata = JSON.parse(readFileSync(join(dir, "metafile-cjs.json"), "utf8"))
  for (const output of Object.values(metadata.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path)) {
        throw new Error(`standalone bundle leaves an external dependency: ${dependency.path}`)
      }
    }
  }
  return join(dir, "safenet.cjs")
}

const only = process.argv.indexOf("--bundle-only")
if (only >= 0) {
  const dir = process.argv[only + 1]
  if (!dir) {
    console.error("build-binary: --bundle-only takes a directory")
    process.exit(2)
  }
  console.log(await bundle(resolve(dir)))
  process.exit(0)
}

const os = { linux: "linux", darwin: "macos", win32: "windows" }[process.platform]
const pinnedNode = readFileSync(join(PACKAGE, "../../.nvmrc"), "utf8").trim()
if (process.versions.node !== pinnedNode) {
  throw new Error(`build:binary requires Node ${pinnedNode} from .nvmrc; running ${process.versions.node}`)
}
if (!os) {
  console.error(`build-binary: no binary for ${process.platform}`)
  process.exit(1)
}
const name = `safenet-${os}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`
const outDir = join(PACKAGE, "binaries")
const out = join(outDir, name)
const work = mkdtempSync(join(tmpdir(), "safenet-binary-"))

try {
  await bundle(work)
  const blob = join(work, "safenet.blob")
  const seaConfig = join(work, "sea-config.json")
  writeFileSync(seaConfig, JSON.stringify({
    // Node stores the main script name in the blob. Keep temporary checkout paths out of it.
    main: "safenet.cjs",
    output: "safenet.blob",
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }))
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { cwd: work, stdio: "inherit" })

  mkdirSync(outDir, { recursive: true })
  rmSync(out, { force: true })
  copyFileSync(process.execPath, out)
  chmodSync(out, 0o755)
  if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", out])
  await inject(out, "NODE_SEA_BLOB", readFileSync(blob), {
    sentinelFuse: FUSE,
    ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
  })
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", out])

  const reported = execFileSync(out, ["--version"], { encoding: "utf8" }).trim()
  if (reported !== version) throw new Error(`the binary reports version ${reported}, the package ${version}`)
  const digest = () => createHash("sha256").update(readFileSync(out)).digest("hex")
  const checksum = digest()
  if (process.argv.includes("--verify-reproducible")) {
    // The second invocation uses a fresh temporary directory, the same pinned Node, and no
    // snapshots or code cache. Hash the final signed/injected executable, not just the bundle.
    execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: PACKAGE, stdio: "inherit" })
    if (digest() !== checksum) throw new Error("two clean binary builds produced different SHA256 checksums")
    console.log(`build-binary: repeated build matches ${checksum}`)
  }
  writeFileSync(join(outDir, `${name}.sha256`), `${checksum}  ${name}\n`)
  console.log(`build-binary: ${out}, safenet ${version}, Node ${process.version}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
