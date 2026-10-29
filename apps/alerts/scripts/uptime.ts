import { Database } from "../src/db.js"
import { loadPollRuns, uptimeReport } from "../src/uptime.js"

const from = Date.parse(process.argv[2] ?? "")
const until = Date.parse(process.argv[3] ?? "")
uptimeReport([], from, until)
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
const db = new Database({ SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key })
const runs = await loadPollRuns(db, from, until)
console.log(JSON.stringify(uptimeReport(runs, from, until), null, 2))
