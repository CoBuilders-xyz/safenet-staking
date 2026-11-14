import { test } from "node:test"
import assert from "node:assert/strict"
import { AdminError, deleteWebhook, describe, setWebhook, webhookInfo, webhookUrl } from "./webhook-admin.js"

const env = { TELEGRAM_BOT_TOKEN: "123456:test-only-token", TELEGRAM_WEBHOOK_SECRET: "w".repeat(40), ALERTS_URL: "https://safenet-alerts.example.workers.dev" }
const url = "https://safenet-alerts.example.workers.dev/telegram/webhook"

/** Telegram, with the webhook it currently holds. */
function telegram(start = "") {
  const state = { url: start, calls: [] as { method: string; body: Record<string, unknown> }[] }
  const transport: typeof fetch = async (input, init) => {
    assert.ok(String(input).startsWith(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/`))
    const method = String(input).split("/").at(-1)!
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>
    state.calls.push({ method, body })
    if (method === "setWebhook") state.url = body.url as string
    if (method === "deleteWebhook") state.url = ""
    return Response.json({ ok: true, result: method === "getWebhookInfo"
      ? { url: state.url, pending_update_count: 2, max_connections: 40, allowed_updates: ["message", "callback_query"], last_error_date: 1_800_000_000, last_error_message: "Wrong response from the webhook: 401 Unauthorized" }
      : true })
  }
  return Object.assign(state, { transport })
}

test("set registers the Worker's URL with the secret, the two update kinds and no pending updates, then reads it back", async () => {
  const api = telegram()
  const info = await setWebhook(env, api.transport)
  assert.deepEqual(api.calls[0], { method: "setWebhook", body: { url, secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"], drop_pending_updates: true } })
  assert.equal(api.calls[1]!.method, "getWebhookInfo")
  assert.deepEqual(info, { url, pendingUpdates: 2, allowedUpdates: ["message", "callback_query"], maxConnections: 40,
    lastErrorAt: "2027-01-15T08:00:00.000Z", lastError: "Wrong response from the webhook: 401 Unauthorized" })
  assert.equal(webhookUrl({ ALERTS_URL: "https://safenet-alerts.example.workers.dev/" }), url)
})

test("set refuses a bad URL or a weak secret before it calls Telegram", async () => {
  const api = telegram()
  for (const changes of [{ ALERTS_URL: undefined }, { ALERTS_URL: "http://safenet-alerts.example.workers.dev" }, { ALERTS_URL: "https://host.example/path" },
    { ALERTS_URL: "https://user:pass@host.example" }, { ALERTS_URL: "https://host.example/?q=1" }, { ALERTS_URL: "not a url" },
    { TELEGRAM_WEBHOOK_SECRET: undefined }, { TELEGRAM_WEBHOOK_SECRET: "short" }, { TELEGRAM_WEBHOOK_SECRET: `${"w".repeat(40)}!` },
    { TELEGRAM_BOT_TOKEN: "" }]) {
    await assert.rejects(setWebhook({ ...env, ...changes }, api.transport), AdminError)
  }
  assert.equal(api.calls.length, 0)
})

test("delete keeps pending updates for a polling Worker, and info reports without changing anything", async () => {
  const api = telegram(url)
  assert.equal((await webhookInfo(env, api.transport)).url, url)
  assert.deepEqual(api.calls.map(call => call.method), ["getWebhookInfo"])
  const info = await deleteWebhook(env, api.transport)
  assert.deepEqual(api.calls[1], { method: "deleteWebhook", body: { drop_pending_updates: false } })
  assert.equal(info.url, "")
})

test("a failure never carries the token or the secret", async () => {
  const leaks = (error: unknown) => {
    const text = `${(error as Error).message} ${String((error as Error).cause ?? "")}`
    return text.includes(env.TELEGRAM_BOT_TOKEN) || text.includes(env.TELEGRAM_WEBHOOK_SECRET)
  }
  const thrown: typeof fetch = async input => { throw new Error(`fetch failed: ${String(input)}`) }
  await assert.rejects(setWebhook(env, thrown), error => error instanceof AdminError && !leaks(error) && /did not answer setWebhook/.test(error.message))
  const refused: typeof fetch = async () => Response.json({ ok: false, description: `Unauthorized for bot${env.TELEGRAM_BOT_TOKEN}` }, { status: 401 })
  await assert.rejects(webhookInfo(env, refused), error => error instanceof AdminError && !leaks(error) && /Telegram refused getWebhookInfo: Unauthorized for bot<token>/.test(error.message))
  // Telegram says yes but holds another URL: the command fails instead of reporting success.
  const other = telegram()
  const stuck: typeof fetch = async (input, init) => String(input).endsWith("/setWebhook") ? Response.json({ ok: true, result: true }) : other.transport(input, init)
  await assert.rejects(setWebhook(env, stuck), /reports another URL/)
})

test("the printed report says whether the webhook is this Worker's, and prints no credential", async () => {
  const api = telegram(url)
  const info = await webhookInfo(env, api.transport)
  const lines = describe(info, env)
  assert.deepEqual(lines, [
    "webhook: registered for this Worker",
    `url: ${url}`,
    "allowed updates: message, callback_query",
    "pending updates: 2",
    "max connections: 40",
    "last error: 2027-01-15T08:00:00.000Z Wrong response from the webhook: 401 Unauthorized",
  ])
  assert.equal(describe(info, { ...env, ALERTS_URL: "https://other.example" })[0], "webhook: registered for ANOTHER URL")
  assert.equal(describe(info, {})[0], "webhook: registered")
  assert.equal(describe({ ...info, url: "", lastErrorAt: null, lastError: null }, env)[0], "webhook: not registered: Telegram delivers no update")
  assert.equal(lines.join("\n").includes(env.TELEGRAM_BOT_TOKEN) || lines.join("\n").includes(env.TELEGRAM_WEBHOOK_SECRET), false)
})
