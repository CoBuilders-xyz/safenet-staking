import { test } from "node:test"
import assert from "node:assert/strict"
import { NETWORK_SUBGRAPH_IDS } from "@cobuilders/safenet-core"
import { REQUIRED_DEPLOY_SECRETS, deploySecrets } from "./deploy-secrets.js"

const env = { ...Object.fromEntries(REQUIRED_DEPLOY_SECRETS.map(name => [name, `test-only-${name.toLowerCase()}`])),
  TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret_0123456789ABCDEF", ALERTS_URL: "https://safenet-alerts.example.workers.dev" }

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

test("a webhook secret or a Worker origin the Worker would not use fails the deploy, by name and never by value", () => {
  for (const secret of ["too-short-for-a-secret", "base64+with/padding=0123456789ABCDEFGHIJ", ` ${"a".repeat(40)}`, "a".repeat(257)]) {
    assert.throws(() => deploySecrets({ ...env, TELEGRAM_WEBHOOK_SECRET: secret }), (error: Error) =>
      error.message === "TELEGRAM_WEBHOOK_SECRET must be 32 to 256 characters of A-Z, a-z, 0-9, _ and -" && !error.message.includes(secret))
  }
  for (const url of ["http://safenet-alerts.example.workers.dev", "https://safenet-alerts.example.workers.dev/telegram/webhook", "safenet-alerts.example.workers.dev", "https://user:pass@host.example"]) {
    assert.throws(() => deploySecrets({ ...env, ALERTS_URL: url }), /^Error: ALERTS_URL must be the alerts Worker's https origin/)
  }
  assert.equal(deploySecrets({ ...env, ALERTS_URL: "https://safenet-alerts.example.workers.dev/" }).ALERTS_URL, "https://safenet-alerts.example.workers.dev/")
})
