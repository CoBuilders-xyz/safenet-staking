// Runs check-installed-package.mjs against fake installs: a `safenet` binary and a `safenet-mcp`
// stdio server, each a few lines that behave as told by FAKE_MODE. The real packages are checked
// against Mainnet by the publish workflow.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const SCRIPT = resolve(import.meta.dirname, "../check-installed-package.mjs")

const FAKE_CLI = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ")
const mode = process.env.FAKE_MODE
if (args === "--version") console.log("1.2.3")
else if (args === "--help") console.log("Usage: safenet [options] [command]")
else if (args === "status --json") {
  // An empty variable would be an endpoint of "". The check must leave it out instead.
  if (process.env.MAINNET_RPC_URL === "") {
    console.error("error: MAINNET_RPC_URL is set but empty")
    process.exit(1)
  }
  if (mode === "fail") {
    console.error("error: the read failed at https://rpc.invalid/secret-key")
    process.exit(1)
  }
  console.log(mode === "text" ? "not json" : JSON.stringify({ block: "7", totalStaked: { value: "5" } }))
}
`

const FAKE_MCP = `#!/usr/bin/env node
const mode = process.env.FAKE_MODE
if (mode === "exit") { console.error("not started: a setting is wrong."); process.exit(2) }
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  let result
  if (m.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "safenet-mcp", version: "1.2.3" } }
  else if (m.method === "tools/list") result = { tools: [{ name: "status" }, { name: "validators_list" }] }
  else if (mode === "fail") result = { isError: true, content: [{ type: "text", text: "SEF's file no longer has the shape this tool reads." }] }
  else result = { content: [{ type: "text", text: "ok" }], structuredContent: { block: "7", totalStaked: { value: "5" } } }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n")
})
`

/** Installs the fake package of `kind` into a fresh directory and runs the check there. */
function check(kind, { mode = "ok", rpc = "https://rpc.invalid/secret-key", executable = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-installed-"))
  try {
    const name = kind === "cli" ? "safenet-cli" : "safenet-mcp"
    const bin = kind === "cli" ? "safenet" : "safenet-mcp"
    mkdirSync(join(dir, "node_modules/@cobuilders", name), { recursive: true })
    mkdirSync(join(dir, "node_modules/.bin"), { recursive: true })
    writeFileSync(join(dir, "node_modules/@cobuilders", name, "package.json"), JSON.stringify({ version: "1.2.3" }))
    writeFileSync(join(dir, "node_modules/.bin", bin), kind === "cli" ? FAKE_CLI : FAKE_MCP)
    chmodSync(join(dir, "node_modules/.bin", bin), executable ? 0o755 : 0o644)
    const summary = join(dir, "summary.md")
    const { MAINNET_RPC_URL: _, ...env } = process.env
    const run = spawnSync(process.execPath, [SCRIPT, kind, dir], {
      env: { ...env, FAKE_MODE: mode, GITHUB_STEP_SUMMARY: summary, CHECK_TIMEOUT_MS: "10000", MAINNET_RPC_URL: rpc },
      encoding: "utf8",
    })
    return { status: run.status, output: run.stdout + run.stderr, summary: readFileSync(summary, "utf8") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("an installed CLI that answers --version, --help and status passes, and the summary says so", () => {
  const { status, output, summary } = check("cli")
  assert.equal(status, 0, output)
  assert.match(output, /pass {2}safenet --version: 1\.2\.3, installed 1\.2\.3/)
  assert.match(output, /pass {2}safenet status --json: block 7, totalStaked 5 wei/)
  assert.match(summary, /\| safenet status --json \| pass \|/)
})

test("a status that fails fails the check, with its sentence and no URL", () => {
  const { status, output, summary } = check("cli", { mode: "fail" })
  assert.equal(status, 1)
  assert.match(output, /FAIL {2}safenet status --json: exit 1: error: the read failed at <redacted-url>/)
  assert.doesNotMatch(output + summary, /secret-key/)
})

test("a status that prints something other than JSON fails", () => {
  const { status, output } = check("cli", { mode: "text" })
  assert.equal(status, 1)
  assert.match(output, /stdout is not one JSON document/)
})

test("an empty MAINNET_RPC_URL leaves the package its own public endpoints, and says so", () => {
  const { status, output, summary } = check("cli", { rpc: "" })
  assert.equal(status, 0, output)
  assert.match(output, /note {2}reads Mainnet through the package's public endpoints, because MAINNET_RPC_URL is empty/)
  assert.match(output, /pass {2}safenet status --json/)
  assert.match(summary, /\| endpoint \| note \| the package's public endpoints/)
})

test("an installed MCP server that initializes, lists its tools and answers status passes", () => {
  const { status, output } = check("mcp")
  assert.equal(status, 0, output)
  assert.match(output, /pass {2}initialize: safenet-mcp 1\.2\.3, installed 1\.2\.3/)
  assert.match(output, /pass {2}tools\/list: 2 tools/)
  assert.match(output, /pass {2}tools\/call status: block 7, totalStaked 5 wei/)
})

test("a status tool error fails the check with the server's sentence", () => {
  const { status, output } = check("mcp", { mode: "fail" })
  assert.equal(status, 1)
  assert.match(output, /FAIL {2}tools\/call status: SEF's file no longer has the shape this tool reads\./)
})

test("a server that exits at start fails the check with its first line on stderr", () => {
  const { status, output } = check("mcp", { mode: "exit" })
  assert.equal(status, 1)
  assert.match(output, /FAIL {2}initialize: the server exited 2: not started: a setting is wrong\./)
})

test("a binary that cannot start fails each tool with a FAIL line and a summary, not a crash", () => {
  for (const kind of ["cli", "mcp"]) {
    const { status, output, summary } = check(kind, { executable: false })
    assert.equal(status, 1, output)
    assert.match(output, kind === "cli" ? /FAIL {2}safenet --help: exit null: .*EACCES/ : /FAIL {2}initialize: the server exited null: .*EACCES/)
    assert.doesNotMatch(output, /at .*check-installed-package\.mjs/)
    assert.match(summary, /\*\*fail\*\*/)
  }
})
