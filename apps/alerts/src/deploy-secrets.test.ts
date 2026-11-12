import { test } from "node:test"
import assert from "node:assert/strict"
import { NETWORK_SUBGRAPH_IDS } from "@cobuilders/safenet-core"
import { REQUIRED_DEPLOY_SECRETS, deploySecrets } from "./deploy-secrets.js"

const env = Object.fromEntries(REQUIRED_DEPLOY_SECRETS.map(name => [name, `test-only-${name.toLowerCase()}`]))

test("every deploy uploads the subgraph URL: the override, else the gateway URL from the Graph key", () => {
  const derived = deploySecrets(env)
  assert.deepEqual(Object.keys(derived).sort(), [...REQUIRED_DEPLOY_SECRETS, "SUBGRAPH_URL_MAINNET"].sort())
  assert.ok(derived.SUBGRAPH_URL_MAINNET!.startsWith("https://gateway.thegraph.com/api/"))
  assert.ok(derived.SUBGRAPH_URL_MAINNET!.endsWith(`/subgraphs/id/${NETWORK_SUBGRAPH_IDS.mainnet}`))
  assert.equal(deploySecrets({ ...env, SUBGRAPH_URL_MAINNET: "https://graph.test" }).SUBGRAPH_URL_MAINNET, "https://graph.test")
  assert.equal(deploySecrets({ ...env, SUBGRAPH_URL_MAINNET: "" }).SUBGRAPH_URL_MAINNET, derived.SUBGRAPH_URL_MAINNET)
})

test("a missing value fails with its name and never its contents", () => {
  assert.throws(() => deploySecrets({ ...env, GRAPH_API_KEY: "", VAPID_SUBJECT: undefined }), (error: Error) =>
    error.message === "Missing production values: GRAPH_API_KEY, VAPID_SUBJECT" && !error.message.includes("test-only"))
})
