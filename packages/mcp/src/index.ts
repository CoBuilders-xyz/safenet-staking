#!/usr/bin/env node
/**
 * safenet-mcp over stdio. stdout carries the protocol, so everything else goes to stderr: the
 * settings in force at start, and each transaction of a live write as it lands.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ConfigError, readConfig, type ServerConfig } from "./config.js"
import { library } from "./library.js"
import { createServer } from "./server.js"
import { signerLoader } from "./signer.js"

const log = (line: string) => void process.stderr.write(`safenet-mcp: ${line}\n`)

let config: ServerConfig
try {
  config = readConfig(process.env)
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  log(`not started: ${err.message}.`)
  process.exit(2)
}

// Where the RPC endpoint comes from, never the URL: it can carry a key.
const rpc = config.rpcUrl
  ? "SAFENET_MCP_RPC_URL"
  : process.env.MAINNET_RPC_URL
    ? "MAINNET_RPC_URL first, then the public list"
    : "the public list"
for (const notice of config.notices) log(notice)
log(`RPC from ${rpc}; writes ${config.writes.allowed ? "allowed" : "off, every write is a dry run"}.`)
// Which gates every write passes; the endpoint is named by its setting, never by its URL.
log(
  "compliance gates on every write: the sanctions oracle; " +
    `the sanctions endpoint ${config.compliance.sanctionsEndpoint ? "in SAFENET_MCP_SANCTIONS_ENDPOINT" : "not set"}; ` +
    `the geo check ${config.compliance.geoCheck ? "on" : "off"}.`,
)

const server = createServer(config, { lib: library, loadSigner: signerLoader(process.env), log })
await server.connect(new StdioServerTransport())
