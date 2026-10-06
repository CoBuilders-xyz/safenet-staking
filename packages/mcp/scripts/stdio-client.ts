/**
 * Starts safenet-mcp from its TypeScript as a child process and connects the SDK's client to it
 * over stdio, as Claude Desktop or Cursor would. The smoke test and `pnpm client` use it.
 */
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))

export async function connectStdio(env: Readonly<Record<string, string | undefined>>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--conditions=source", "--import", "tsx", "src/index.ts"],
    cwd: PACKAGE,
    env: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined)),
    stderr: "pipe",
  })
  let stderr = ""
  transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString()))
  const client = new Client({ name: "safenet-mcp-client", version: "0.0.0" })
  await client.connect(transport)
  return {
    client,
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as CallToolResult,
    /** What the server wrote on stderr so far. */
    stderr: () => stderr,
    close: () => client.close(),
  }
}
