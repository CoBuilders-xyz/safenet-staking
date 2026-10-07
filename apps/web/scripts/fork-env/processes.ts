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
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { constants as osConstants } from "node:os"
import { resolve } from "node:path"
import { STATE_DIR, WEB_DIR } from "./settings"

/** A process the tool started: its pid and its start time, as startedAt() reads it. */
export interface Owned {
  pid: number
  startedAt: string
}

/**
 * Written by anvil-launcher.ts once Anvil is spawned, with `listening` false, so the launcher
 * and Anvil can be stopped while Anvil sets up the fork. Written again with `listening` true
 * when Anvil reports that it listens on the port, which it does only once it holds it. Removed
 * when Anvil exits.
 */
export interface AnvilRecord {
  launcher: Owned
  anvil: Owned
  listening: boolean
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
  /** VITE_STAKING_DEPLOY_BLOCK of its Vite: the fork block. */
  scanFrom: string
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

/** Writes a record whole: under a temporary name, then renamed into place, so no reader sees half of it. */
export function writeRecord(name: string, value: object): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const file = resolve(STATE_DIR, name)
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n")
  renameSync(temporary, file)
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
 * When a process started, or why there is no start time: the process is gone, or it runs but its
 * start time cannot be read. The two must not be confused. A process taken for gone would be
 * forgotten while it runs, and Anvil with it, with the archive endpoint on its command line.
 */
export type StartTime = { readonly at: string } | "gone" | "unreadable"

/**
 * When the process with this pid started.
 *
 * On Linux, field 22 of /proc/<pid>/stat: the start in clock ticks after boot, which no clock
 * step moves. `ps -o lstart=` on Linux derives a wall-clock time from it and the current boot
 * time, so a clock step could make the same process read differently.
 *
 * Elsewhere, macOS among them, `ps -o lstart=`, which there prints the start time the kernel
 * recorded. It prints the time and nothing else: never a command line, which for Anvil carries
 * the archive endpoint. The call runs under a fixed locale and time zone, so the string compares
 * equal from any shell, whatever language or zone it has. ps exits 1 when no process has the
 * pid; any other failure, ps missing or not spawned, leaves the start time unreadable.
 */
export function startedAt(pid: number): StartTime {
  if (!alive(pid)) return "gone"
  if (process.platform === "linux") {
    let stat: string
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return code === "ENOENT" || code === "ESRCH" ? "gone" : "unreadable"
    }
    // Field 2, the command name, is in parentheses and may hold spaces; field 3 follows it.
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[22 - 3]
    return ticks && /^\d+$/.test(ticks) ? { at: `ticks ${ticks}` } : "unreadable"
  }
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "", LC_ALL: "C", TZ: "UTC" },
    }).trim()
    return out ? { at: out } : "unreadable"
  } catch (err) {
    return (err as { status?: number | null }).status === 1 ? "gone" : "unreadable"
  }
}

const cannotRead = (pid: number, consequence: string): Error =>
  new Error(`cannot read the start time of process ${pid}, ${consequence}`)

/**
 * This process as the tool will remember it. Fails when its start time cannot be read: a record
 * without one could never be told apart from a later process with the same pid.
 */
export function self(pid: number): Owned {
  const time = startedAt(pid)
  if (typeof time === "string") throw cannotRead(pid, "so it cannot be recorded as the tool's")
  return { pid, startedAt: time.at }
}

/**
 * Whether the process a record names still runs. "ours": same pid, same start time. "gone": no
 * process has the pid, or another one does. "unknown": a process has the pid, and its start
 * time cannot be read, so it may be the tool's.
 */
export type Ownership = "ours" | "gone" | "unknown"

export function ownership(o: Owned | undefined): Ownership {
  if (!o?.startedAt) return "gone"
  const time = startedAt(o.pid)
  if (time === "gone") return "gone"
  if (time === "unreadable") return "unknown"
  return time.at === o.startedAt ? "ours" : "gone"
}

/**
 * The processes of a record that still run. Fails when one may run but cannot be told apart,
 * before anything is stopped or forgotten: the command changes nothing, and can run again.
 */
export function stillRunning(processes: readonly Owned[]): Owned[] {
  const running: Owned[] = []
  for (const o of processes) {
    const state = ownership(o)
    if (state === "unknown") {
      throw cannotRead(o.pid, "so it is not known whether it is the tool's. Nothing was changed; run the command again.")
    }
    if (state === "ours") running.push(o)
  }
  return running
}

/** Whether something accepts connections on a port of `host`, loopback unless named. */
export function portInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host, port })
    socket.once("connect", () => {
      socket.destroy()
      done(true)
    })
    socket.once("error", () => done(false))
  })
}

/**
 * Starts a script of this directory in its own session, run by the same Node and the same
 * loader as this process, with its output appended to `log`. Returns the child, unreferenced so
 * this process may exit before it. Its exitCode and signalCode say when it has exited, without
 * asking the system about a pid it may since have handed to another process.
 */
export function startDetached(script: string, log: string, env: NodeJS.ProcessEnv): ChildProcess {
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
    return child
  } finally {
    closeSync(fd)
  }
}

/**
 * SIGTERM, then SIGKILL once the grace period passes, to a process the tool started and only
 * while it is still the one the record names. Resolves when it is gone. Fails, so the caller
 * keeps its record, when the process cannot be told apart or does not stop: a start time that
 * cannot be read is never taken for an exit.
 */
export async function terminate(o: Owned, graceMs = 10_000): Promise<void> {
  const state = ownership(o)
  if (state === "gone") return
  if (state === "unknown") throw cannotRead(o.pid, "so it was not stopped. Run the command again.")
  const gone = async () => ownership(o) === "gone"
  try {
    process.kill(o.pid, "SIGTERM")
  } catch {
    return
  }
  if (await waitFor(gone, graceMs)) return
  try {
    process.kill(o.pid, "SIGKILL")
  } catch {
    return
  }
  if (!(await waitFor(gone, 5_000))) throw new Error(`process ${o.pid} did not stop, or its start time cannot be read`)
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

const busy = () => new Error("another fork command is running; wait for it to finish")

/** Links `from` to `to`, which must not exist: an atomic create. False when `to` exists. */
function linkNew(from: string, to: string): boolean {
  try {
    linkSync(from, to)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false
    throw err
  }
}

const sameOwned = (a: Owned | undefined, b: Owned | undefined): boolean =>
  a?.pid === b?.pid && a?.startedAt === b?.startedAt

/**
 * One fork command at a time. Two at once would each start an Anvil for the same port and each
 * write the same records. The lock names the process that holds it; one left by a process that
 * no longer runs is taken over. One whose holder may still run, because its start time cannot
 * be read, is not.
 *
 * The lock appears whole or not at all: it is written under a name of this process's own, then
 * linked into place, which fails when a lock exists. So a reader never sees an empty one. A
 * stale lock is first moved aside under this process's name, which only one of two commands
 * taking it over at once can do; if what was moved is not the stale lock read a moment before,
 * another command has just taken it, and it goes back. Returns this process as the lock names it.
 */
function acquireLock(): Owned {
  mkdirSync(STATE_DIR, { recursive: true })
  const lock = resolve(STATE_DIR, LOCK)
  const mine = `${LOCK}.${process.pid}`
  const aside = `${mine}.stale`
  const me = self(process.pid)
  let keepAside = false
  writeRecord(mine, me)
  try {
    if (linkNew(resolve(STATE_DIR, mine), lock)) return me
    const holder = readRecord<Owned>(LOCK)
    if (ownership(holder) !== "gone") throw busy()
    try {
      renameSync(lock, resolve(STATE_DIR, aside))
    } catch {
      // Gone already: released, or taken over by another command, which the link then meets.
      if (linkNew(resolve(STATE_DIR, mine), lock)) return me
      throw busy()
    }
    const moved = readRecord<Owned>(aside)
    if (!sameOwned(moved, holder)) {
      if (!linkNew(resolve(STATE_DIR, aside), lock)) {
        // A third command took the lock meanwhile. What was moved aside stays where it is.
        keepAside = true
        throw new Error(
          `the lock changed hands while this command took it over, and another command's lock is now apps/web/.fork-env/${aside}. Wait for the other fork commands to finish, then run again.`,
        )
      }
      throw busy()
    }
    if (!linkNew(resolve(STATE_DIR, mine), lock)) throw busy()
    return me
  } finally {
    removeRecord(mine)
    if (!keepAside) removeRecord(aside)
  }
}

/** Removes the lock, but only while it names this process: never a lock another command took. */
function releaseLock(me: Owned): void {
  if (sameOwned(readRecord<Owned>(LOCK), me)) removeRecord(LOCK)
}

/**
 * Runs a command's body under the lock and reports a failure in one redacted line. An error
 * from a read that Anvil forwarded to the archive endpoint can carry that endpoint's URL in its
 * text, and Node's own printer would show the whole error, cause chain included. So nothing but
 * the message, with every URL replaced, reaches the terminal.
 *
 * Interrupted by SIGINT or SIGTERM, the command releases its lock and exits with 128 plus the
 * signal's number, as a shell reports it. What it started in its own session runs on, and the
 * next command finds it by its record.
 */
export async function command(body: () => Promise<void>): Promise<void> {
  let me: Owned | undefined
  const interrupted = (signal: NodeJS.Signals): void => {
    if (me) releaseLock(me)
    process.exit(128 + (osConstants.signals[signal] ?? 0))
  }
  try {
    me = acquireLock()
    process.once("SIGINT", interrupted)
    process.once("SIGTERM", interrupted)
    await body()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`\n  ${redact(message.split("\n")[0] ?? "failed")}\n`)
    process.exitCode = 1
  } finally {
    process.off("SIGINT", interrupted)
    process.off("SIGTERM", interrupted)
    if (me) releaseLock(me)
  }
}
