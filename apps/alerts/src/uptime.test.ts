import { test } from "node:test"
import assert from "node:assert/strict"
import { loadPollRuns, uptimeReport, type PollRun } from "./uptime.js"

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

test("uptime pagination includes all rows when the server caps pages below 1000", async () => {
  const rows: PollRun[] = [0, 300_000, 600_000].map(ms => ({ started_at: new Date(ms).toISOString(), completed_at: new Date(ms + 1000).toISOString(), ok: true }))
  const paths: string[] = []
  const result = await loadPollRuns({ request: async <T>(path: string) => {
    paths.push(path)
    const cursor = new URL(path, "https://unused.test").searchParams.getAll("started_at").find(filter => filter.startsWith("gt."))?.slice(3)
    return rows.filter(row => !cursor || row.started_at > cursor).slice(0, 1) as T
  } }, 0, 900_000)
  assert.deepEqual(result, rows)
  assert.equal(paths.length, 4)
  assert.equal(uptimeReport(result, 0, 900_000).availabilityPercent, 100)
})
