import { Database } from "../src/db.js"
import { uptimeReport, type PollRun } from "../src/uptime.js"

const from = Date.parse(process.argv[2] ?? "")
const until = Date.parse(process.argv[3] ?? "")
uptimeReport([], from, until)
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
const db = new Database({ SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key })
const runs: PollRun[] = []
let cursor: string | undefined
for (;;) {
  const range = `started_at=gte.${encodeURIComponent(new Date(from).toISOString())}&started_at=lt.${encodeURIComponent(new Date(until).toISOString())}`
  const page = await db.request<PollRun[]>(`alerts_runs?${range}&order=started_at.asc&limit=1000${cursor ? `&started_at=gt.${encodeURIComponent(cursor)}` : ""}`)
  runs.push(...page)
  if (page.length < 1000) break
  cursor = page.at(-1)!.started_at
}
console.log(JSON.stringify(uptimeReport(runs, from, until), null, 2))
