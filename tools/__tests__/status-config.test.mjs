// ops/status/config.yaml names values that packages/core owns. YAML cannot import them, so this
// fails when core moves one and the status page still checks the old: a new Studio version, a
// gateway, the ENS name, a public RPC. ci.yml's status-config job proves Gatus accepts the file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  IPFS_GATEWAYS,
  NETWORK_SUBGRAPH_IDS,
  PUBLIC_RPC_URLS,
  SUBGRAPH_ENDPOINTS,
  WEB_ENS_NAME,
} from "../../packages/core/src/index.ts"

const config = readFileSync(resolve(import.meta.dirname, "../../ops/status/config.yaml"), "utf8")
const urls = [...config.matchAll(/^\s*url: (\S+)$/gm)].map((m) => m[1])

test("checks each subgraph on the Network gateway, by the IDs core publishes", () => {
  for (const id of Object.values(NETWORK_SUBGRAPH_IDS)) {
    assert.ok(urls.includes(`https://gateway.thegraph.com/api/subgraphs/id/${id}`), id)
  }
  const gateway = urls.filter((u) => u.startsWith("https://gateway.thegraph.com/"))
  assert.deepEqual(new Set(gateway), new Set(Object.values(NETWORK_SUBGRAPH_IDS).map((id) => `https://gateway.thegraph.com/api/subgraphs/id/${id}`)))
})

test("checks the Studio deployments core names, and no other", () => {
  const studio = urls.filter((u) => u.startsWith("https://api.studio.thegraph.com/"))
  assert.deepEqual(new Set(studio), new Set(Object.values(SUBGRAPH_ENDPOINTS)))
})

test("checks each IPFS gateway in core, through the ENS name", () => {
  for (const gateway of IPFS_GATEWAYS) {
    assert.ok(urls.includes(`${gateway}/ipns/${WEB_ENS_NAME}/index.html`), gateway)
  }
  assert.ok(urls.includes(`https://${WEB_ENS_NAME}.limo/`))
})

test("reads finalized blocks from the first public RPC of each chain in core", () => {
  for (const chain of ["mainnet", "gnosis"]) {
    assert.ok(urls.includes(PUBLIC_RPC_URLS[chain][0]), chain)
  }
})

test("carries no secret, only the names Gatus expands", () => {
  const names = new Set([...config.matchAll(/\$\{([A-Z_]+)\}/g)].map((m) => m[1]))
  assert.deepEqual(names, new Set(["GATUS_SQLITE_PATH", "PORT", "SLACK_WEBHOOK_URL", "FRIDAY_WEBHOOK_URL", "FRIDAY_WEBHOOK_KEY", "GRAPH_API_KEY"]))
  // The gateway key travels in a header: a check's URL is shown on the page and sent in alert
  // payloads. Only the Friday webhook, which is no check, is a URL from the environment.
  assert.deepEqual(urls.filter((u) => u.includes("$")), ["${FRIDAY_WEBHOOK_URL}"])
})
