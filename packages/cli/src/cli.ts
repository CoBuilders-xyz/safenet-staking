/**
 * The program: commander wiring, output and exit codes. No chain logic lives here.
 *
 *   0  success
 *   1  the operation failed; one plain sentence on stderr
 *   2  usage error: unknown command or option, missing argument, invalid value
 */
import { Command, CommanderError } from "commander"
import pkg from "../package.json" with { type: "json" }
import {
  createContext, errorSentence as librarySentence, redactUrls, rpcEndpoints, rpcHosts, scrubSecrets, ScanError,
  type Context, type ContextOptions, type Progress, type Signer, type WriteMode,
} from "./lib/index.js"
import { ARCHIVE_ADVICE, toJson } from "./commands/format.js"
import { globalSchema, parseOptions, UsageError, type GlobalOptions, type WriteRequest } from "./commands/options.js"
import { terminalPasswordPrompt } from "./commands/prompt.js"
import { registerRewards } from "./commands/rewards.js"
import { loadSigner, type SignerRequest } from "./commands/signer.js"
import { registerStake } from "./commands/stake.js"
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
  /** Turns the signer options into a signer. Tests replace it to inject their own. */
  readonly loadSigner: (request: SignerRequest, ctx: Context) => Promise<Signer>
}

/** What a command needs from the program: its global options, a context, and output. */
export interface CommandRuntime {
  readonly io: Io
  globals(command: Command): GlobalOptions
  context(globals: GlobalOptions): Context
  /** --json prints the data; otherwise the rendered text. */
  emit<T>(globals: GlobalOptions, data: T, render: (data: T) => string): void
  /**
   * The mode the write options ask for: a signer to send with, or the address a dry run
   * simulates from. A dry run with a signer option loads the signer for its address only.
   */
  writeMode(request: WriteRequest, ctx: Context): Promise<WriteMode>
  /** Reports each transaction of a live write as it lands, on stderr, so --json stays one document. */
  progress(render: (event: Progress) => string): (event: Progress) => void
}

/**
 * A usage error with anything that may be a secret taken out: the value of a `--flag=value`,
 * which commander repeats for an unknown option such as `--private-key=<key>`, and URLs and runs
 * of 64 or more hex digits. See `scrubSecrets()` in the library.
 */
export const scrubUsage = scrubSecrets

/** One plain sentence for an error, with any URL removed: an RPC URL can carry a key. */
export function errorSentence(err: unknown): string {
  return librarySentence(err, ARCHIVE_ADVICE)
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
    async writeMode(request, ctx) {
      if (!request.signer) {
        // writeSchema allows no signer only for a dry run with --from.
        return { dryRun: true, from: request.from! }
      }
      const signer = await runtime.loadSigner(request.signer, ctx)
      if (request.from && request.from !== signer.address) {
        throw new UsageError(`--from ${request.from} is not the signer's address ${signer.address}`)
      }
      return request.dryRun ? { dryRun: true, from: signer.address } : { dryRun: false, signer }
    },
    progress(render) {
      return (event) => runtime.io.err(`${render(event)}\n`)
    },
  }
}

export function buildProgram(runtime: Runtime): Command {
  const program = new Command("safenet")
    .description(
      "Read Safenet Beta from Ethereum Mainnet and from the data SEF publishes, and stake, unstake and claim. " +
        "Every write takes --dry-run, which signs nothing.",
    )
    .version(pkg.version)
    .option("--json", "machine output with the same fields; amounts in wei as decimal strings")
    .option("--rpc-url <url>", "Mainnet RPC endpoint (default: MAINNET_RPC_URL, then public endpoints)")
    .option("-v, --verbose", "print the RPC host in use, never its full URL, to stderr")
    .exitOverride()
    .configureOutput({
      writeOut: runtime.io.out,
      writeErr: runtime.io.err,
      outputError: (text, write) => write(scrubUsage(text)),
    })
    .showHelpAfterError("(run with --help for usage)")

  const rt = commandRuntime(runtime)
  registerStatus(program, rt)
  registerStake(program, rt)
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
      runtime.io.err(`error: ${scrubUsage(err.message)}\n`)
      return 2
    }
    runtime.io.err(`error: ${errorSentence(err)}\n`)
    if ((argv.includes("--verbose") || argv.includes("-v")) && err instanceof Error && err.stack) {
      runtime.io.err(`${redactUrls(err.stack)}\n`)
      // A scan wraps the RPC error that ended it. Show it, with URLs removed like everything else.
      if (err instanceof ScanError && err.cause !== undefined) {
        const cause = err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : String(err.cause)
        runtime.io.err(`Caused by: ${redactUrls(cause)}\n`)
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
    loadSigner: (request, ctx) =>
      loadSigner(request, ctx, { env: process.env, askPassword: terminalPasswordPrompt() }),
  }
}
