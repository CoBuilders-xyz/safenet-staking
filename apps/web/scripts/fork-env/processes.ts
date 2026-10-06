/**
 * What the tool keeps under apps/web/.fork-env, and the process helpers the three commands
 * share.
 *
 * Anvil and the proxy each run in their own session, started detached so they outlive the shell
 * that ran `fork:up`, and each leaves a record with its pids and their start times. A pid is the
 * tool's own only while a process with that start time holds it: a pid the system handed to
 * another process after a crash or a restart is never signalled. `fork:down` stops the pids in
 * those records and nothing else, never a process this tool did not start, even one on the same
 * port.
 */
import { execFileSync, spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { resolve } from "node:path"
import { STATE_DIR, WEB_DIR } from "./settings"

/** A process the tool started: its pid and the start time `ps` reports for it. */
export interface Owned {
  pid: number
  startedAt: string
}

/** Written by anvil-launcher.ts once Anvil is spawned, removed when Anvil exits. */
export interface AnvilRecord {
  launcher: Owned
  anvil: Owned
  port: number
  block: string
  sefRef: string
  testAmount: string
  testBalance: string
}

/** Written by `fork:up` once the chain holds the baseline and its snapshot is taken. */
export interface SetupRecord {
  account: string
  root: string
  block: string
  sefRef: string
  testAmount: string
  testBalance: string
  /** What the wallet holds after the funding, in wei: the funding plus whatever it held at the fork block. */
  balance: string
  claimable: string
  carriedOver: number
  skipped: number
  sourceRootMatchesFork: boolean
  snapshotId: string
}

/** Written by proxy-launcher.ts once it listens, removed when it exits. */
export interface ProxyRecord {
  proxy: Owned
  vite: Owned
  host: string
  proxyPort: number
  webPort: number
  anvilPort: number
  origin: string
  validatorInfo: string
}

export const ANVIL_RECORD = "anvil.json"
export const SETUP_RECORD = "setup.json"
export const PROXY_RECORD = "proxy.json"
export const ANVIL_LOG = resolve(STATE_DIR, "anvil.log")
export const PROXY_LOG = resolve(STATE_DIR, "proxy.log")

/**
 * Every URL replaced, whatever its scheme and case, except a loopback one: an archive endpoint's
 * carries a key, the tool's own name only a port. A URL ends at whitespace or at a quote, a
 * bracket, a parenthesis or a backslash, so one inside a JSON string or an error message leaves
 * the rest intact.
 */
export const redact = (text: string): string =>
  text.replace(/(?:https?|wss?):\/\/(?!127\.0\.0\.1|localhost)[^\s"'<>()\\]+/gi, "<redacted-url>")

export function readRecord<T>(name: string): T | undefined {
  const file = resolve(STATE_DIR, name)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

export function writeRecord(name: string, value: object): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(resolve(STATE_DIR, name), JSON.stringify(value, null, 2) + "\n")
}

export function removeRecord(name: string): void {
  rmSync(resolve(STATE_DIR, name), { force: true })
}

export function alive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * When the process with this pid started, as `ps` prints it, or undefined when there is none.
 * `ps -o lstart=` prints the time and nothing else: never a command line, which for Anvil
 * carries the archive endpoint. The call runs under a fixed locale and time zone, so the string
 * compares equal from any shell, whatever language or zone it has.
 */
export function startedAt(pid: number): string | undefined {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "", LC_ALL: "C", TZ: "UTC" },
    }).trim()
    return out || undefined
  } catch {
    return undefined
  }
}

/** This process as the tool will remember it. */
export const self = (pid: number): Owned => ({ pid, startedAt: startedAt(pid) ?? "" })

/** Whether the process the record names still runs: same pid, same start time. */
export function owned(o: Owned | undefined): boolean {
  return !!o && o.startedAt !== "" && alive(o.pid) && startedAt(o.pid) === o.startedAt
}

/** Whether something accepts connections on a loopback port. */
export function portInUse(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => {
      socket.destroy()
      done(true)
    })
    socket.once("error", () => done(false))
  })
}

/**
 * Starts a script of this directory in its own session, run by the same Node and the same
 * loader as this process, with its output appended to `log`. Returns its pid.
 */
export function startDetached(script: string, log: string, env: NodeJS.ProcessEnv): number {
  mkdirSync(STATE_DIR, { recursive: true })
  const fd = openSync(log, "a")
  try {
    const child = spawn(process.execPath, [...process.execArgv, resolve(import.meta.dirname, script)], {
      cwd: WEB_DIR,
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
    })
    child.unref()
    if (child.pid === undefined) throw new Error(`could not start ${script}`)
    return child.pid
  } finally {
    closeSync(fd)
  }
}

/**
 * SIGTERM, then SIGKILL once the grace period passes, to a process the tool started and only
 * while it is still the one the record names. Resolves when the pid is gone or no longer ours.
 */
export async function terminate(o: Owned, graceMs = 10_000): Promise<void> {
  if (!owned(o)) return
  try {
    process.kill(o.pid, "SIGTERM")
  } catch {
    return
  }
  if (await waitFor(async () => !owned(o), graceMs)) return
  try {
    process.kill(o.pid, "SIGKILL")
  } catch {
    return
  }
  await waitFor(async () => !owned(o), 5_000)
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Polls `check` until it holds or the timeout passes. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, everyMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(everyMs)
  }
  return check()
}

/** One JSON-RPC call. Its result, or undefined when nothing answers or the answer is an error. */
export async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return undefined
    const body = (await res.json()) as { result?: unknown; error?: unknown }
    return body.error === undefined ? body.result : undefined
  } catch {
    return undefined
  }
}

/** Two aligned columns, as scripts/setup.sh prints. */
export function say(what: string, detail: string): void {
  console.log(`  ${what.padEnd(14)} ${detail}`)
}

const LOCK = "lock.json"

/**
 * One fork command at a time. Two at once would each start an Anvil for the same port and each
 * write the same records. The lock names the process that holds it; one left by a process that
 * no longer runs is taken over.
 */
function acquireLock(): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const file = resolve(STATE_DIR, LOCK)
  const holder = readRecord<Owned>(LOCK)
  if (owned(holder)) throw new Error("another fork command is running; wait for it to finish")
  writeFileSync(file, JSON.stringify(self(process.pid)) + "\n")
}

/**
 * Runs a command's body under the lock and reports a failure in one redacted line. An error
 * from a read that Anvil forwarded to the archive endpoint can carry that endpoint's URL in its
 * text, and Node's own printer would show the whole error, cause chain included. So nothing but
 * the message, with every URL replaced, reaches the terminal.
 */
export async function command(body: () => Promise<void>): Promise<void> {
  let locked = false
  try {
    acquireLock()
    locked = true
    await body()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`\n  ${redact(message.split("\n")[0] ?? "failed")}\n`)
    process.exitCode = 1
  } finally {
    if (locked) removeRecord(LOCK)
  }
}
