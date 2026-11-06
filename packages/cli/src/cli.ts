/**
 * The program: commander wiring, output and exit codes. No chain logic lives here.
 *
 *   0  success
 *   1  the operation failed; one plain sentence on stderr
 *   2  usage error: unknown command or option, missing argument, invalid value
 */
import { subgraphEndpoints } from "@cobuilders/safenet-core"
import { Command, CommanderError } from "commander"
import { BaseError, HttpRequestError } from "viem"
import pkg from "../package.json" with { type: "json" }
import {
  ComplianceRefusal, createContext, errorSentence as librarySentence, redactUrls, rpcEndpoints, rpcHosts, scrubSecrets, ScanError, SafenetError,
  type Context, type ContextOptions, type Progress, type Signer, type WriteMode,
} from "./lib/index.js"
import { ARCHIVE_ADVICE, toJson } from "./commands/format.js"
import { globalSchema, parseOptions, UsageError, type GlobalOptions, type WriteRequest } from "./commands/options.js"
import { showWalletPairing, terminalPasswordPrompt } from "./commands/prompt.js"
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

/**
 * Printed once whenever a write loads its key from --private-key-env. Any process the shell
 * starts inherits the variable, and it can end up in logs or crash reports; a keystore holds the
 * key encrypted.
 */
export const ENV_KEY_WARNING =
  "Warning: environment private keys enter this process and can leak through process inspection or diagnostics. Prefer a hardware wallet or a keystore (--keystore), which keeps the key encrypted on disk."

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
        ipfsGateway: runtime.env.IPFS_GATEWAY || undefined,
        subgraphUrl: subgraphEndpoints({ graphApiKey: runtime.env.GRAPH_API_KEY, overrides: { mainnet: runtime.env.SUBGRAPH_URL_MAINNET } }).mainnet,
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
      if (request.signer.kind === "private-key-env") {
        runtime.io.err(`${ENV_KEY_WARNING}\n`)
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
      "Read Safenet from Ethereum Mainnet and from the data SEF publishes, and stake, unstake and claim. " +
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
  const signers: Signer[] = []
  const program = buildProgram({ ...runtime, loadSigner: async (request, ctx) => {
    const signer = await runtime.loadSigner(request, ctx)
    signers.push(signer)
    return signer
  } })
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
    // A refused gate is an answer, not a breakdown: with --json the report is the document on
    // stdout, so a script can read which gate refused and why. The sentence goes to stderr as usual.
    if (err instanceof ComplianceRefusal && argv.includes("--json")) {
      runtime.io.out(`${toJson({ refused: true, compliance: err.report })}\n`)
    }
    runtime.io.err(`error: ${errorSentence(err)}\n`)
    if ((argv.includes("--verbose") || argv.includes("-v")) && err instanceof Error && err.stack) {
      runtime.io.err(`${redactUrls(err.stack)}\n`)
      // Provider messages and stacks can echo short credentials outside URLs. Only print a validated status.
      const scan = err instanceof ScanError ? err
        : err instanceof SafenetError && err.cause instanceof ScanError ? err.cause : undefined
      if (scan?.cause !== undefined) {
        const http = scan.cause instanceof BaseError
          ? scan.cause.walk((cause) => cause instanceof HttpRequestError) : undefined
        const status = http instanceof HttpRequestError && typeof http.status === "number" &&
          Number.isInteger(http.status) && http.status >= 100 && http.status <= 599 ? http.status : undefined
        runtime.io.err(`Caused by: RPC log request failed (${status === undefined ? "provider details omitted" : `HTTP ${status}`}).\n`)
      }
    }
    return 1
  } finally {
    await Promise.allSettled(signers.map((signer) => signer.close?.()))
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
    async loadSigner(request, ctx) {
      const prompt = terminalPasswordPrompt()
      if (request.kind !== "walletconnect") return loadSigner(request, ctx, { env: process.env, askPassword: prompt })
      if (!prompt) throw new UsageError("WalletConnect needs an interactive terminal; use --dry-run --from for automation")
      const controller = new AbortController()
      const cancel = () => controller.abort()
      process.once("SIGINT", cancel)
      process.once("SIGTERM", cancel)
      const off = () => { process.off("SIGINT", cancel); process.off("SIGTERM", cancel) }
      try {
        const signer = await loadSigner(request, ctx, {
          env: process.env, askPassword: prompt,
          wallet: {
            signal: controller.signal,
            showUri: showWalletPairing,
            async confirm(review, signal) {
              process.stderr.write(`Review transaction (amounts and fees in wei):\n${review}\n` +
                "Warning: the wallet signs and broadcasts. Cancellation or timeout cannot stop a pending wallet request.\n")
              return await terminalPasswordPrompt(signal)!("Compare with your device. Type sign to request signing and broadcast: ") === "sign"
            },
          },
        })
        return { ...signer, async close() { try { await signer.close?.() } finally { off() } } }
      } catch (err) { off(); throw err }
    },
  }
}
