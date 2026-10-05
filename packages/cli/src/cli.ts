/**
 * The program: commander wiring, output and exit codes. No chain logic lives here.
 *
 *   0  success
 *   1  the operation failed; one plain sentence on stderr
 *   2  usage error: unknown command or option, missing argument, invalid value
 */
import { Command, CommanderError } from "commander"
import { BaseError } from "viem"
import pkg from "../package.json" with { type: "json" }
import {
  createContext, rpcEndpoints, rpcHosts, SafenetError, ScanError, type Context, type ContextOptions,
} from "./lib/index.js"
import { ARCHIVE_ADVICE, toJson } from "./commands/format.js"
import { globalSchema, parseOptions, UsageError, type GlobalOptions } from "./commands/options.js"
import { registerRewards } from "./commands/rewards.js"
import { registerStatus } from "./commands/status.js"
import { registerValidators } from "./commands/validators.js"
import { registerWithdrawals } from "./commands/withdrawals.js"

export interface Io {
  /** Results. Written as given; no newline is added. */
  readonly out: (text: string) => void
  /** Errors, help after an error, and --verbose diagnostics. */
  readonly err: (text: string) => void
}

export interface Runtime {
  readonly io: Io
  readonly env: Readonly<Record<string, string | undefined>>
  readonly createContext: (options: ContextOptions) => Context
}

/** What a command needs from the program: its global options, a context, and output. */
export interface CommandRuntime {
  readonly io: Io
  globals(command: Command): GlobalOptions
  context(globals: GlobalOptions): Context
  /** --json prints the data; otherwise the rendered text. */
  emit<T>(globals: GlobalOptions, data: T, render: (data: T) => string): void
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

/** One plain sentence for an error, with any URL removed: an RPC URL can carry a key. */
export function errorSentence(err: unknown): string {
  let text: string
  if (err instanceof ScanError) text = `${err.message}; ${ARCHIVE_ADVICE}`
  else if (err instanceof SafenetError) text = err.message
  else if (err instanceof BaseError) text = `The Mainnet RPC request failed: ${err.shortMessage}`
  else if (err instanceof Error) text = err.message
  else text = String(err)
  const line = (text.split("\n")[0] ?? "").replace(URL_PATTERN, "<url>").trim()
  if (line.length === 0) return "Something failed without a message."
  return /[.!?]$/.test(line) ? line : `${line}.`
}

function commandRuntime(runtime: Runtime): CommandRuntime {
  return {
    io: runtime.io,
    globals: (command) => parseOptions(globalSchema, command.optsWithGlobals()),
    context(globals) {
      if (globals.verbose) {
        const hosts = rpcHosts(rpcEndpoints(globals.rpcUrl ?? undefined)).join(", ")
        const why = globals.rpcUrl
          ? "--rpc-url"
          : runtime.env.MAINNET_RPC_URL
            ? "MAINNET_RPC_URL first, then the public list"
            : "the public list"
        runtime.io.err(`rpc: ${hosts} (from ${why}; tried in that order)\n`)
      }
      return runtime.createContext({
        rpcUrl: globals.rpcUrl,
        githubToken: runtime.env.GITHUB_TOKEN || runtime.env.GH_TOKEN || undefined,
      })
    },
    emit(globals, data, render) {
      runtime.io.out(`${globals.json ? toJson(data) : render(data)}\n`)
    },
  }
}

export function buildProgram(runtime: Runtime): Command {
  const program = new Command("safenet")
    .description(
      "Read Safenet Beta from Ethereum Mainnet and from the data SEF publishes. Read-only: nothing is signed.",
    )
    .version(pkg.version)
    .option("--json", "machine output with the same fields; amounts in wei as decimal strings")
    .option("--rpc-url <url>", "Mainnet RPC endpoint (default: MAINNET_RPC_URL, then public endpoints)")
    .option("-v, --verbose", "print the RPC host in use, never its full URL, to stderr")
    .exitOverride()
    .configureOutput({ writeOut: runtime.io.out, writeErr: runtime.io.err })
    .showHelpAfterError("(run with --help for usage)")

  const rt = commandRuntime(runtime)
  registerStatus(program, rt)
  registerValidators(program, rt)
  registerWithdrawals(program, rt)
  registerRewards(program, rt)
  return program
}

/** Runs one command line (without `node` and the script) and returns the exit code. */
export async function run(argv: readonly string[], runtime: Runtime): Promise<number> {
  const program = buildProgram(runtime)
  try {
    await program.parseAsync([...argv], { from: "user" })
    return 0
  } catch (err) {
    // commander has already printed its own message. Help and --version exit 0.
    if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : 2
    if (err instanceof UsageError) {
      runtime.io.err(`error: ${err.message}\n`)
      return 2
    }
    runtime.io.err(`error: ${errorSentence(err)}\n`)
    if ((argv.includes("--verbose") || argv.includes("-v")) && err instanceof Error && err.stack) {
      runtime.io.err(`${err.stack.replace(URL_PATTERN, "<url>")}\n`)
      // A scan wraps the RPC error that ended it. Show it, with URLs removed like everything else.
      if (err instanceof ScanError && err.cause !== undefined) {
        const cause = err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : String(err.cause)
        runtime.io.err(`Caused by: ${cause.replace(URL_PATTERN, "<url>")}\n`)
      }
    }
    return 1
  }
}

export function processRuntime(): Runtime {
  return {
    io: {
      out: (text) => void process.stdout.write(text),
      err: (text) => void process.stderr.write(text),
    },
    env: process.env,
    createContext,
  }
}
