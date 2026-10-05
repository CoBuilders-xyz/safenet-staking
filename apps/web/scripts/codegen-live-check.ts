/**
 * Validates the GraphQL documents against a running graph-node.
 *
 * Codegen checks the documents against a schema derived from each schema.graphql
 * (scripts/subgraph-api-schema.ts). That derivation follows graph-node's rules but is ours, so
 * this checks the same documents against what a node actually serves. Run it after deploying
 * both subgraphs to the local node, or with VITE_SUBGRAPH_URL_MAINNET and
 * VITE_SUBGRAPH_URL_GNOSIS set to deployed endpoints.
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
  const body = (await res.json()) as { data?: IntrospectionQuery }
  if (!body.data) throw new Error(`${chain}: no introspection result`)
  const schema = buildClientSchema(body.data)
  const dir = join(ROOT, "src/graphql", chain)
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".graphql"))) {
    const errors = validate(schema, parse(readFileSync(join(dir, file), "utf8")))
    for (const e of errors) console.error(`  FAIL ${chain}/${file}: ${e.message}`)
    failures += errors.length
    if (errors.length === 0) console.log(`  OK   ${chain}/${file}`)
  }
}
if (failures > 0) process.exitCode = 1
