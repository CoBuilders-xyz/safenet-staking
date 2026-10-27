#!/usr/bin/env node
// Checks a package as a user gets it: installed from its tarball, outside the monorepo, so
// nothing resolves from the workspace.
//
//   cli  `safenet --version` gives the installed version, `safenet --help` exits 0, and
//        `safenet status --json` reads Mainnet and returns a positive total staked.
//   mcp  `safenet-mcp` starts over stdio, answers initialize, lists its tools, and answers a
//        `status` call with a positive total staked.
//
//   node tools/check-installed-package.mjs <cli|mcp> <directory the tarball was installed into>
//
// Each binary is run through node_modules/.bin, so the package's `bin` entry and its shebang are
// part of the check. Reads MAINNET_RPC_URL. One line per check on stdout, and a table in
// $GITHUB_STEP_SUMMARY when it is set. No line carries a URL: an RPC URL can hold a key.
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"

const PACKAGES = {
  cli: { name: "@cobuilders/safenet-cli", bin: "safenet" },
  mcp: { name: "@cobuilders/safenet-mcp", bin: "safenet-mcp" },
}
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS ?? 180_000)

const redact = (text) => String(text).replace(/https?:\/\/\S+/g, "<redacted-url>")
const isWei = (v) => typeof v === "string" && /^\d+$/.test(v)

const [kind, dir] = process.argv.slice(2)
const pkg = PACKAGES[kind]
if (!pkg || !dir) {
  console.error("usage: node tools/check-installed-package.mjs <cli|mcp> <install directory>")
  process.exit(2)
}

const results = []
function record(check, ok, detail) {
  results.push({ check, ok, detail: redact(detail) })
  console.log(`${ok ? "pass" : "FAIL"}  ${check}: ${redact(detail)}`)
}

/** Runs the package's binary to the end and returns its exit code and output. */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(join(dir, "node_modules", ".bin", pkg.bin), args, { cwd: dir, env })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: err.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** The first line of a failure's stderr, which the CLI keeps to one sentence. */
const firstLine = (text) => text.trim().split("\n")[0] || "no output"

async function checkCli(env) {
  const version = await run(["--version"], env)
  record("safenet --version", version.code === 0 && version.stdout.trim() === installedVersion,
    version.code === 0 ? `${version.stdout.trim()}, installed ${installedVersion}` : firstLine(version.stderr))

  const help = await run(["--help"], env)
  record("safenet --help", help.code === 0 && help.stdout.includes("Usage: safenet"),
    help.code === 0 ? "exit 0" : `exit ${help.code}: ${firstLine(help.stderr)}`)

  const status = await run(["status", "--json"], env)
  if (status.code !== 0) {
    record("safenet status --json", false, `exit ${status.code}: ${firstLine(status.stderr)}`)
    return
  }
  let data
  try {
    data = JSON.parse(status.stdout)
  } catch {
    record("safenet status --json", false, "stdout is not one JSON document")
    return
  }
  const staked = data?.totalStaked?.value
  record("safenet status --json", isWei(staked) && BigInt(staked) > 0n,
    `block ${data?.block}, totalStaked ${staked} wei`)
}

/** Starts the server and talks JSON-RPC to it over stdio, one message per line. */
async function checkMcp(env) {
  const child = spawn(join(dir, "node_modules", ".bin", pkg.bin), [], { cwd: dir, env })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += d))
  const waiting = new Map()
  let buffer = ""
  child.stdout.on("data", (d) => {
    buffer += d
    let i
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      waiting.get(msg.id)?.(msg)
    }
  })
  // A binary that cannot start, such as a broken `bin` link, emits `error` and never `close`. A
  // write to a server that has exited fails on stdin. Either becomes a failed check, not a crash.
  const exited = new Promise((resolve) => {
    child.on("close", (code) => resolve(code))
    child.on("error", (err) => {
      stderr += err.message
      resolve(null)
    })
  })
  child.stdin.on("error", () => {})
  const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`)
  const request = (id, method, params) =>
    Promise.race([
      new Promise((resolve) => {
        waiting.set(id, resolve)
        send({ id, method, params })
      }),
      exited.then((code) => ({ error: { message: `the server exited ${code}: ${firstLine(stderr)}` } })),
      new Promise((resolve) => setTimeout(() => resolve({ error: { message: `no answer in ${TIMEOUT_MS} ms` } }), TIMEOUT_MS)),
    ])

  try {
    const init = await request(0, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "check-installed-package", version: "1.0.0" },
    })
    const server = init.result?.serverInfo
    record("initialize", server?.version === installedVersion,
      init.error ? init.error.message : `${server?.name} ${server?.version}, installed ${installedVersion}`)
    if (init.error) return
    send({ method: "notifications/initialized" })

    const list = await request(1, "tools/list", {})
    const names = list.result?.tools?.map((t) => t.name) ?? []
    record("tools/list", names.includes("status"), list.error ? list.error.message : `${names.length} tools`)

    const call = await request(2, "tools/call", { name: "status", arguments: {} })
    const result = call.result
    if (call.error || !result || result.isError) {
      const text = result?.content?.[0]?.text
      record("tools/call status", false, call.error?.message ?? text ?? "no result")
      return
    }
    const staked = result.structuredContent?.totalStaked?.value
    record("tools/call status", isWei(staked) && BigInt(staked) > 0n,
      `block ${result.structuredContent?.block}, totalStaked ${staked} wei`)
  } finally {
    child.kill()
  }
}

let installedVersion
try {
  installedVersion = JSON.parse(readFileSync(join(dir, "node_modules", pkg.name, "package.json"), "utf8")).version
} catch {
  console.error(`${pkg.name} is not installed under ${dir}.`)
  process.exit(1)
}

if (!process.env.MAINNET_RPC_URL) {
  record("MAINNET_RPC_URL", false, "empty: the status check reads Mainnet and needs the endpoint")
} else {
  // The server's own settings are cleared, so it runs as the README configures it: reads through
  // MAINNET_RPC_URL, writes off.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SAFENET_MCP_")))
  await (kind === "cli" ? checkCli(env) : checkMcp(env))
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) => `| ${r.check} | ${r.ok ? "pass" : "**fail**"} | ${r.detail.replaceAll("|", "\\|")} |`)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    [`### ${pkg.name} ${installedVersion}, installed from its tarball`, "", "| Check | Result | Detail |", "|---|---|---|", ...rows, ""].join("\n") + "\n")
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
