/**
 * Starts Anvil on a fork of Mainnet at MAINNET_FORK.blockNumber, the block the web fork suite
 * uses, and stops it again. The same launch as apps/web/e2e/fork/anvil.ts, owned by this suite
 * so it never shares a port or a process with that one.
 *
 * Anvil echoes the fork URL, which carries a key. Nothing it prints is passed on unredacted.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createConnection } from "node:net"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { MAINNET_FORK } from "@cobuilders/safenet-core"

const redact = (text: string) => text.replace(/https?:\/\/\S+/g, "<redacted-url>")

/**
 * The port for this suite's Anvil. scripts/setup.sh writes CLI_ANVIL_PORT into .env.ports at the
 * repository root, one per worktree. An exported variable wins. Without either, CI's default,
 * which is one above the web suite's 8545 so both suites can run at once.
 */
export function cliAnvilPort(): number {
  const file = resolve(import.meta.dirname, "../../../../.env.ports")
  const ports = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}
  return Number(process.env.CLI_ANVIL_PORT ?? ports.CLI_ANVIL_PORT ?? "8546")
}

export interface Anvil {
  readonly url: string
  /** The last lines Anvil printed, URLs removed, for a failure report. */
  logTail(): string
  /** Kills this Anvil, and only this one, and waits for it to exit. */
  stop(): Promise<void>
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => {
      socket.destroy()
      done(true)
    })
    socket.once("error", () => done(false))
  })
}

async function waitForRpc(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`anvil exited with code ${child.exitCode} before it answered`)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      })
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`anvil did not answer on ${url} within ${timeoutMs / 1000} s`)
}

/**
 * Starts Anvil and resolves once it answers. A port already taken fails the run: a leftover Anvil
 * would serve state from an earlier run, and a test against it proves nothing.
 */
export async function startAnvil(forkUrl: string, port: number, log: (line: string) => void): Promise<Anvil> {
  if (await portInUse(port)) {
    throw new Error(`port ${port} is already in use. Stop whatever listens there, or set CLI_ANVIL_PORT.`)
  }
  const child = spawn(
    "anvil",
    [
      "--fork-url", forkUrl,
      "--fork-block-number", MAINNET_FORK.blockNumber.toString(),
      "--host", "127.0.0.1",
      "--port", String(port),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  const spawnError = new Promise<never>((_, reject) =>
    child.once("error", (err) => reject(new Error(`anvil could not start (${redact(err.message)}). Install Foundry.`))),
  )
  let tail = ""
  const keep = (chunk: Buffer) => {
    tail = (tail + redact(chunk.toString())).slice(-4000)
  }
  child.stdout.on("data", keep)
  child.stderr.on("data", keep)

  // If the test process dies without running its cleanup, this child dies with it. Only this one.
  const killOnExit = () => void child.kill("SIGKILL")
  process.once("exit", killOnExit)

  const url = `http://127.0.0.1:${port}`
  const stop = async () => {
    process.off("exit", killOnExit)
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((r) => child.once("exit", () => r()))
    child.kill("SIGTERM")
    const killed = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))])
    if (!killed) {
      child.kill("SIGKILL")
      await exited
    }
  }
  try {
    await Promise.race([waitForRpc(url, child, 60_000), spawnError])
  } catch (err) {
    await stop()
    log(tail)
    throw err
  }
  return { url, stop, logTail: () => tail }
}
