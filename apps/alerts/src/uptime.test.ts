import { test } from "node:test"
import assert from "node:assert/strict"
import { uptimeReport } from "./uptime.js"

test("uptime counts missing runs and incomplete runs as downtime, without counting retries twice", () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const rows = [
    { started_at: iso(0), completed_at: iso(1000), ok: true },
    { started_at: iso(2000), completed_at: iso(3000), ok: true },
    { started_at: iso(300_000), completed_at: null, ok: true },
    { started_at: iso(900_000), completed_at: iso(901_000), ok: false },
  ]
  assert.deepEqual(uptimeReport(rows, 0, 1_200_000), { from: iso(0), until: iso(1_200_000), expected: 4, successful: 1, failedOrMissing: 3, availabilityPercent: 25 })
  assert.throws(() => uptimeReport([], 1, 300_000), /aligned/)
})
