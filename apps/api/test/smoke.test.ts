import assert from "node:assert/strict"
import { test } from "node:test"
import { selectSmokeTarget } from "../scripts/smoke-target.js"
import { OTHER, TARGET } from "./fixtures.js"

const rows = [{ address: OTHER, is_active: true }, { address: TARGET, is_active: false }]

test("smoke skips active validators missing either detail or history prerequisites", async () => {
  for (const missing of ["detail", "history"]) {
    const seen: string[] = []
    const fetcher = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      seen.push(path)
      const fails = path.includes(OTHER) && (missing === "history" ? path.endsWith("/history") : !path.endsWith("/history"))
      return Response.json({}, { status: fails ? 503 : 200 })
    }) as typeof fetch
    assert.equal(await selectSmokeTarget(rows, "http://api.test", fetcher), rows[1])
    assert.ok(seen.includes(`/v1/validators/${TARGET}`))
    assert.ok(seen.includes(`/v1/validators/${TARGET}/history`))
  }
})

test("smoke retains active-or-first fallback when no validator qualifies", async () => {
  const unavailable = (async () => Response.json({}, { status: 503 })) as typeof fetch
  assert.equal(await selectSmokeTarget(rows, "http://api.test", unavailable), rows[0])
  const inactive = rows.map(v => ({ ...v, is_active: false }))
  assert.equal(await selectSmokeTarget(inactive, "http://api.test", unavailable), inactive[0])
})
