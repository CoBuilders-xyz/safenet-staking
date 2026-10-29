import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { smokeBinary } from "../scripts/smoke-binary.js"

// The standalone binary runs one CommonJS script with every dependency inside, and can require
// only Node's own modules. scripts/build-binary.mjs writes that script with --bundle-only; this
// test runs it with plain node from an empty directory, so nothing resolves from the workspace.
// Building the binary itself, 100 MB and more, is left to the binaries workflow.

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const { version } = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { version: string }

test("the binary's bundle runs reads and dry runs without workspace dependencies", { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "safenet-sea-"))
  const alone = mkdtempSync(join(tmpdir(), "safenet-sea-alone-"))
  try {
    const script = execFileSync(process.execPath, [join(PACKAGE, "scripts/build-binary.mjs"), "--bundle-only", work], {
      cwd: PACKAGE, encoding: "utf8",
    }).trim()
    const copy = join(alone, "safenet.cjs")
    copyFileSync(script, copy)
    const source = readFileSync(copy, "utf8")
    assert.doesNotMatch(source, /require\("(commander|viem|zod|@cobuilders\/[^"]+)"\)/, "a dependency was left outside the bundle")

    const run = (...args: string[]) => execFileSync(process.execPath, [copy, ...args], { cwd: alone, encoding: "utf8" })
    assert.equal(run("--version").trim(), version)
    assert.match(run("--help"), /^Usage: safenet \[options\] \[command\]/)
    const metadata = JSON.parse(readFileSync(join(work, "metafile-cjs.json"), "utf8"))
    const inputs = Object.keys(metadata.inputs).join("\n")
    assert.match(inputs, /@walletconnect\/sign-client/)
    assert.match(inputs, /@walletconnect\/core/)
    assert.doesNotMatch(source, /require\(["'](?:bufferutil|utf-8-validate)["']\)/)
    await smokeBinary(copy, process.execPath)
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(alone, { recursive: true, force: true })
  }
})
