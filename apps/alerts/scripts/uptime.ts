import { Database } from "../src/db.js"
import { loadPollRuns, uptimeReport } from "../src/uptime.js"

const from = Date.parse(process.argv[2] ?? "")
const until = Date.parse(process.argv[3] ?? "")
uptimeReport([], from, until)
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const database = process.env.ALERTS_D1_DATABASE_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!account || !database || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID, ALERTS_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN are required")

/** Reads the production database through the D1 query API. Only the read that loadPollRuns makes is supported. */
async function query(sql: string, params: unknown[]): Promise<unknown[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30_000),
  })
  // Never print the response body: an error can echo request details.
  if (!response.ok) throw new Error(`D1 query failed (${response.status})`)
  const body = await response.json() as { success: boolean; result: { results: unknown[] }[] }
  if (!body.success || !body.result[0]) throw new Error("D1 query failed")
  return body.result[0].results
}
const d1 = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ all: async () => ({ results: await query(sql, params) }) }) }) }
const db = new Database(d1 as unknown as D1Database)
const runs = await loadPollRuns(db, from, until)
console.log(JSON.stringify(uptimeReport(runs, from, until), null, 2))
