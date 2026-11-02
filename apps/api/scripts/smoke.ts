import assert from "node:assert/strict"
import { selectSmokeTarget } from "./smoke-target.js"
const base = process.env.API_URL
if (!base) throw new Error("Set API_URL to the Worker origin. This smoke uses real HTTP, without mocks.")
const first = await fetch(new URL("/v1/validators", base))
assert.equal(first.status, 200, await first.clone().text())
const rows = await first.json() as { address: string; label: string; is_active: boolean; commission: number; participation_rate_14d: number | null }[]
assert.ok(rows.length)
const target = await selectSmokeTarget(rows, base)
for (const path of ["/v1/validators", `/v1/validators/${target.address}`, ...["7d", "30d", "all"].map(w => `/v1/validators/${target.address}/history?window=${w}`), `/v1/validators/${target.address}/events`, "/v1/system/stats", "/v1/health"]) {
  const start = performance.now()
  const response: Response = await fetch(new URL(path, base))
  const data: unknown = await response.json()
  console.log(JSON.stringify({ path, status: response.status, durationMs: Math.round(performance.now() - start), cache: response.headers.get("X-Cache") }))
  assert.equal(response.status, 200, JSON.stringify(data))
  assert.ok(data)
}
console.log(JSON.stringify({ result: "PASS", validators: rows.length, target: target.address, checkedAt: new Date().toISOString(), environment: new URL(base).hostname }))
