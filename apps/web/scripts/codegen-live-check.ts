/**
 * Validates the GraphQL documents against a running graph-node.
 *
 * Codegen checks the documents against a schema derived from each schema.graphql
 * (scripts/subgraph-api-schema.ts). That derivation follows graph-node's rules but is ours, so
 * this checks the same documents against what a node actually serves. With nothing set it reads
 * the defaults in packages/core, the Studio deployments. Set VITE_SUBGRAPH_URL_MAINNET and
 * VITE_SUBGRAPH_URL_GNOSIS to point it at the local node after deploying both subgraphs there,
 * or at another deployment.
 *
 *   pnpm --filter @cobuilders/safenet-web codegen:live-check
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseEnv } from "node:util"
import { buildClientSchema, getIntrospectionQuery, parse, validate, type IntrospectionQuery } from "graphql"
import { subgraphEndpoints, type ChainKey } from "@cobuilders/safenet-core"

const ROOT = resolve(import.meta.dirname, "..")
const portsFile = resolve(ROOT, "../../.env.ports")
const ports = existsSync(portsFile) ? parseEnv(readFileSync(portsFile, "utf8")) : {}
const endpoints = subgraphEndpoints({
  graphNodePort: process.env.GRAPH_NODE_PORT ?? ports.GRAPH_NODE_PORT,
  overrides: { mainnet: process.env.VITE_SUBGRAPH_URL_MAINNET, gnosis: process.env.VITE_SUBGRAPH_URL_GNOSIS },
})

let failures = 0
for (const chain of ["mainnet", "gnosis"] as ChainKey[]) {
  const url = endpoints[chain]
  if (!url) throw new Error(`${chain}: no endpoint`)
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  })
  // The URL is not printed: an override may carry a key by mistake, and output is no place for it.
  if (!res.ok) throw new Error(`${chain}: the endpoint answered HTTP ${res.status}`)
  const body = (await res.json()) as { data?: IntrospectionQuery; errors?: { message: string }[]; message?: string }
  if (body.errors?.length) throw new Error(`${chain}: ${body.errors.map((e) => e.message).join("; ")}`)
  // Studio answers a retired version label with HTTP 200 and {"message":"Not found"}.
  if (!body.data) {
    throw new Error(
      `${chain}: the endpoint answered "${body.message ?? "no data"}"; check VITE_SUBGRAPH_URL_${chain.toUpperCase()}, ` +
        "or the default in packages/core/src/subgraphs.ts when it is unset",
    )
  }
  const schema = buildClientSchema(body.data)
  const dir = join(ROOT, "src/graphql", chain)
  // Documents share freshness fragments across files. Validate them together, as codegen does.
  const document = parse(readdirSync(dir).filter((f) => f.endsWith(".graphql"))
    .map((file) => readFileSync(join(dir, file), "utf8")).join("\n"))
  const errors = validate(schema, document)
  for (const e of errors) console.error(`  FAIL ${chain}: ${e.message}`)
  failures += errors.length
  if (errors.length === 0) console.log(`  OK   ${chain}: all documents and shared fragments`)
}
if (failures > 0) process.exitCode = 1
