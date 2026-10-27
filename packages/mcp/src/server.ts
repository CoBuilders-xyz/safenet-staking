/**
 * The MCP server: lists the tools, checks each call's arguments, calls the library, and returns
 * the result as structured content with a short text summary.
 *
 * A write runs as a dry run first, always. It is sent only when the operator started the server
 * with writes allowed and a signer, and the call sets `dryRun: false`; then the result holds the
 * dry run and, after it, the execution. Otherwise `dryRun: false` is overridden to true and the
 * signer is never loaded, so nothing can be signed.
 *
 * A failure comes back as a tool error: one sentence, no stack, no URL, and no value that may be
 * a secret.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError,
  type CallToolResult, type Tool as ToolDefinition,
} from "@modelcontextprotocol/sdk/types.js"
import type { z } from "zod"
import {
  ComplianceRefusal, errorSentence, scrubSecrets,
  type Context, type Progress, type Signer, type WriteMode, type WriteResultBase,
} from "@cobuilders/safenet-cli/lib"
import { readFileSync } from "node:fs"
import type { ServerConfig } from "./config.js"
import type { Library } from "./library.js"
import type { LoadSigner } from "./signer.js"
import { ARCHIVE_ADVICE, writeSummary } from "./summary.js"
import { inputJsonSchema, TOOLS, type ReadTool, type Tool, type WriteTool } from "./tools.js"

/**
 * The package's version, read at start. package.json sits one level up from both src/ and dist/,
 * and npm always ships it, so the bundle does not carry the whole file for one field.
 */
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version

export interface Dependencies {
  readonly lib: Library
  readonly loadSigner: LoadSigner
  /** Lines for stderr: each transaction of a live write as it lands. Never a key or a URL. */
  readonly log: (line: string) => void
}

/** Bad arguments to a tool. The message names the argument and never repeats its value. */
class ToolInputError extends Error {
  override readonly name = "ToolInputError"
}

const NO_SECRETS =
  "A key or a password never goes in a tool argument: the operator configures the signer when the server starts"

/** A name that only a signer setting would have. */
const SECRET_NAME = /key|pass|secret|mnemonic|seed|keystore|signer|wallet/i

/** 64 hex digits is what a private key looks like. No tool takes one. */
const KEY_LIKE = /^(0x)?[0-9a-fA-F]{64}$/

/** Where the first string, name or value, that looks like a private key is. */
function keyLike(value: unknown, path: string): string | null {
  if (typeof value === "string") return KEY_LIKE.test(value.trim()) ? `the argument ${path}` : null
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (KEY_LIKE.test(k)) return path ? `a name inside the argument ${path}` : "an argument name"
      const found = keyLike(v, path ? `${path}.${k}` : k)
      if (found) return found
    }
  }
  return null
}

/** Each tool's argument names, from the schema a client sees. */
const ARGUMENTS = new Map(
  TOOLS.map((t) => [t.name, Object.keys((inputJsonSchema(t).properties ?? {}) as Record<string, unknown>)]),
)

function parseArguments(tool: Tool, raw: unknown): unknown {
  const args = raw ?? {}
  if (typeof args !== "object" || Array.isArray(args)) throw new ToolInputError(`${tool.name} takes its arguments as an object`)
  const found = keyLike(args, "")
  if (found) {
    throw new ToolInputError(
      `${tool.name} refused ${found}: it holds 64 hex digits, which is what a private key looks like. ${NO_SECRETS}`,
    )
  }
  const known = ARGUMENTS.get(tool.name) ?? []
  const unknown = Object.keys(args).filter((k) => !known.includes(k))
  if (unknown.some((k) => SECRET_NAME.test(k))) {
    throw new ToolInputError(`${tool.name} takes no signer argument. ${NO_SECRETS}`)
  }
  if (unknown.length > 0) {
    throw new ToolInputError(
      `${tool.name} got ${unknown.length} argument${unknown.length === 1 ? "" : "s"} it does not take; ` +
        `it takes ${known.length ? known.join(", ") : "none"}`,
    )
  }
  const result = (tool.input as z.ZodType).safeParse(args)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.join(".") ?? ""
  const message = issue?.message ?? "invalid arguments"
  throw new ToolInputError(where && !message.startsWith(where) ? `${where}: ${message}` : message)
}

/** The JSON the CLI prints with --json: bigints as decimal strings, dates as ISO strings. */
export function toStructured(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value)))
}

function result(summary: string, structured: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      // For clients that pass only the text content to the model.
      { type: "text", text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured,
  }
}

function failure(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: scrubSecrets(text) }] }
}

function progressLine(tool: string, event: Progress): string {
  switch (event.type) {
    case "sent":
      return `${tool}: sent ${event.contract}.${event.functionName}: ${event.hash}, waiting for its receipt`
    case "confirmed": {
      const t = event.step.transaction!
      return `${tool}: confirmed ${event.step.contract}.${event.step.function.split("(")[0]}: ${t.hash}, block ${t.block}, status ${t.status}`
    }
    case "received":
      return `${tool}: received ${event.amount.safe} SAFE, from ${event.source}`
    case "capped":
      return `${tool}: staking ${event.received.safe} SAFE instead of the requested ${event.requested.safe}`
  }
}

export function createServer(config: ServerConfig, deps: Dependencies): Server {
  const server = new Server(
    { name: "safenet-mcp", title: "Safenet", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Reads Safenet staking on Ethereum Mainnet and the data SEF publishes. Every figure carries its source. " +
        "Amounts are wei as decimal strings, with SAFE amounts as decimal strings next to them in write results. " +
        (config.writes.allowed
          ? "Writes are allowed: a write tool with dryRun false signs with the operator's signer and sends; run it with dryRun true first."
          : "Writes are off: every write tool returns a dry run, simulated from the address in from, and signs nothing."),
    },
  )

  let ctx: Context | undefined
  const context = () =>
    (ctx ??= deps.lib.createContext({
      rpcUrl: config.rpcUrl, githubToken: config.githubToken, ipfsGateway: config.ipfsGateway, subgraphUrl: config.subgraphUrl,
    }))

  // Live writes run one at a time, so two calls never race for the same nonce.
  let tail: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => undefined)
    return run
  }

  const definitions: ToolDefinition[] = TOOLS.map((tool) => {
    const sends = tool.kind === "write" && config.writes.allowed
    const gate = tool.kind === "read"
      ? ""
      : config.writes.allowed
        ? " This server sends when dryRun is false, signed by the operator's signer; the result holds the dry run, then the execution."
        : " This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
    return {
      name: tool.name,
      description: `${tool.description}${gate}`,
      inputSchema: inputJsonSchema(tool) as ToolDefinition["inputSchema"],
      annotations: {
        title: `safenet ${tool.command.join(" ")}`,
        readOnlyHint: !sends,
        destructiveHint: sends,
        idempotentHint: !sends,
        openWorldHint: true,
      },
    }
  })

  async function callRead(tool: ReadTool, args: unknown): Promise<CallToolResult> {
    const data = await tool.run(deps.lib, context(), args)
    return result(tool.summary(data), toStructured(data))
  }

  async function callWrite(tool: WriteTool, args: unknown): Promise<CallToolResult> {
    const request = tool.request(args)
    const forced = !request.dryRun && !config.writes.allowed
    let dryMode: WriteMode
    let signer: Signer | null = null
    if (config.writes.allowed) {
      const loaded = await deps.loadSigner(config.writes.signer, context())
      if (request.from && request.from !== loaded.address) {
        throw new ToolInputError(`from ${request.from} is not the signer's address ${loaded.address}`)
      }
      dryMode = { dryRun: true, from: loaded.address }
      if (!request.dryRun) signer = loaded
    } else {
      if (!request.from) {
        throw new ToolInputError(
          `A dry run needs an address to simulate from: pass from. This server has no signer, because ${config.writes.reason}`,
        )
      }
      dryMode = { dryRun: true, from: request.from }
    }

    // The gates run in both: a refusal stops the dry run, and a live run reads them again.
    const dryRun: WriteResultBase = await tool.run(deps.lib, context(), dryMode, args, { compliance: request.compliance })
    let execution: WriteResultBase | null = null
    if (signer) {
      const live: WriteMode = { dryRun: false, signer }
      execution = await exclusive(() =>
        tool.run(deps.lib, context(), live, args, {
          onProgress: (e) => deps.log(progressLine(tool.name, e)),
          compliance: request.compliance,
        }),
      )
    }

    const lines = [
      ...(forced ? [`dryRun was forced to true: ${config.writes.reason}.`] : []),
      writeSummary(dryRun),
      ...(execution ? [writeSummary(execution)] : []),
    ]
    return result(lines.join(" "), {
      writesAllowed: config.writes.allowed,
      dryRunForced: forced,
      dryRun: toStructured(dryRun),
      execution: execution ? toStructured(execution) : null,
    })
  }

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name)
    if (!tool) throw new McpError(ErrorCode.InvalidParams, scrubSecrets(`No tool is named ${request.params.name}`))
    try {
      const args = parseArguments(tool, request.params.arguments)
      return tool.kind === "read" ? await callRead(tool, args) : await callWrite(tool, args)
    } catch (err) {
      if (err instanceof ToolInputError) return failure(err.message)
      // A refused gate is an answer: the sentence, and the report as structured content.
      if (err instanceof ComplianceRefusal) {
        return { ...failure(errorSentence(err, ARCHIVE_ADVICE)), structuredContent: { refused: true, compliance: toStructured(err.report) } }
      }
      return failure(errorSentence(err, ARCHIVE_ADVICE))
    }
  })

  return server
}
