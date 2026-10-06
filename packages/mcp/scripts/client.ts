/**
 * Calls one tool of safenet-mcp over stdio and prints the result: the summary, then the
 * structured content. The server gets this process's environment, so the SAFENET_MCP_* settings
 * and MAINNET_RPC_URL apply as they would in a desktop client's config.
 *
 *   pnpm --filter @cobuilders/safenet-mcp client --list
 *   pnpm --filter @cobuilders/safenet-mcp client status
 *   pnpm --filter @cobuilders/safenet-mcp client stake '{"validator":"0x…","amount":"1","from":"0x…"}'
 */
import { connectStdio } from "./stdio-client.js"

const [name, json] = process.argv.slice(2)
if (!name) {
  console.error("usage: client --list | client <tool> ['{\"argument\":\"value\"}']")
  process.exit(2)
}

const server = await connectStdio(process.env)
try {
  if (name === "--list") {
    for (const t of (await server.client.listTools()).tools) {
      console.log(`${t.name}(${Object.keys(t.inputSchema.properties ?? {}).join(", ")})`)
    }
  } else {
    const r = await server.call(name, json ? (JSON.parse(json) as Record<string, unknown>) : {})
    const [summary] = r.content
    console.log(r.isError ? "tool error:" : "summary:", summary?.type === "text" ? summary.text : "")
    if (r.structuredContent) console.log(JSON.stringify(r.structuredContent, null, 2))
    process.exitCode = r.isError ? 1 : 0
  }
} finally {
  process.stderr.write(server.stderr())
  await server.close()
}
