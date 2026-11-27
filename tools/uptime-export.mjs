#!/usr/bin/env node
// Exports the uptime of every check on the status page (ops/status), as JSON and Markdown.
//
// Gatus keeps hourly and daily uptime for about 30 days, then deletes it. This export is the
// record that outlives it: .github/workflows/uptime-export.yml runs it weekly and keeps each
// report as an artifact. The reports serve the >= 95 % uptime evidence and the operational
// reports.
//
// Two measures per check, from Gatus's public API:
//
//   checks  Gatus's own uptime: successful checks over all checks, for 24 h, 7 days and 30 days.
//   time    The share of time the check was healthy, from its state changes ("events"), for the
//           last 8 days, the month to date and the previous month. Gatus keeps events by count,
//           not by age, so they reach further back than its uptime. The report says how much of
//           each window the events cover. Gatus writes an event on every change, so one failed
//           check counts as downtime until the next success, whatever the alert threshold.
//
// Suites keep no uptime in Gatus; the report gives the share of their last 100 runs that passed,
// the most Gatus's API returns in one page.
//
//   STATUS_URL=https://status.example node tools/uptime-export.mjs <output directory>
//
// Writes uptime-<date>.json and uptime-<date>.md there, and the Markdown to GITHUB_STEP_SUMMARY
// when set. Exits 1 when STATUS_URL is unset or the status page does not answer.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const SLA = 0.95
const DAY = 24 * 60 * 60 * 1000

/** The three windows, in UTC: the last 8 days (a weekly run overlaps the one before), the month to date, and the previous month. */
export function windows(now) {
  const date = new Date(now)
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  const previousStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)
  return [
    { id: "last8d", label: "Last 8 days", from: now - 8 * DAY, to: now },
    { id: "monthToDate", label: `${new Date(monthStart).toISOString().slice(0, 7)} to date`, from: monthStart, to: now },
    { id: "previousMonth", label: new Date(previousStart).toISOString().slice(0, 7), from: previousStart, to: monthStart },
  ]
}

/**
 * Healthy time over observed time in [from, to), from Gatus events in chronological order:
 * START when monitoring began, then HEALTHY or UNHEALTHY on each change of state.
 *
 * Time before the oldest event Gatus kept is not observed: before a START there was no
 * monitoring, and before an older event Gatus dropped, the state is unknown. So `observedMs` can
 * be less than the window, and `coverage` says how much less. Returns the downtime intervals
 * clipped to the window.
 */
export function availability(events, from, to) {
  const sorted = events
    .map((e) => ({ type: e.type, at: Date.parse(e.timestamp) }))
    .filter((e) => !Number.isNaN(e.at))
    .sort((a, b) => a.at - b.at)
  /** "up", "down", or undefined while not observed. */
  let state
  let cursor = from
  let observedMs = 0
  let downMs = 0
  const outages = []
  const advance = (until) => {
    const end = Math.min(until, to)
    if (end > cursor && state) {
      observedMs += end - cursor
      if (state === "down") {
        downMs += end - cursor
        const last = outages.at(-1)
        if (last && last.end === cursor) last.end = end
        else outages.push({ start: cursor, end })
      }
    }
    cursor = Math.max(cursor, end)
  }
  for (const event of sorted) {
    if (event.at >= to) break
    advance(event.at)
    state = event.type === "HEALTHY" ? "up" : event.type === "UNHEALTHY" ? "down" : undefined
  }
  advance(to)
  // Down at the end of the window and no later change: the outage has not ended yet.
  const ongoing = state === "down" && !sorted.some((e) => e.at >= to)
  return {
    uptime: observedMs > 0 ? 1 - downMs / observedMs : null,
    observedMs,
    downMs,
    coverage: observedMs / (to - from),
    outages: outages.map((o, i) => ({
      start: new Date(o.start).toISOString(),
      end: ongoing && i === outages.length - 1 && o.end === to ? null : new Date(o.end).toISOString(),
      minutes: Math.round((o.end - o.start) / 60_000),
    })),
  }
}

async function get(fetchImpl, url, as) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return as === "text" ? response.text() : response.json()
}

/** Reads every endpoint and suite from the status page and builds the report. */
export async function buildReport(fetchImpl, statusUrl, now) {
  const api = (path) => new URL(`/api/v1/${path}`, statusUrl).href
  const spans = windows(now)
  const endpoints = await get(fetchImpl, api("endpoints/statuses?page=1&pageSize=1"))
  const checks = []
  for (const { key, name, group } of endpoints) {
    const id = encodeURIComponent(key)
    const gatus = {}
    for (const duration of ["24h", "7d", "30d"]) {
      const text = await get(fetchImpl, api(`endpoints/${id}/uptimes/${duration}`), "text")
      const value = Number.parseFloat(text)
      gatus[duration] = Number.isFinite(value) ? value : null
    }
    const { events = [] } = await get(fetchImpl, api(`endpoints/${id}/statuses?page=1&pageSize=1`))
    const time = Object.fromEntries(spans.map((w) => [w.id, availability(events, w.from, w.to)]))
    checks.push({ key, group, name, gatus, time })
  }
  // Newest first, at most 100 a page.
  const suites = (await get(fetchImpl, api("suites/statuses?page=1&pageSize=100"))).map(({ key, name, group, results = [] }) => ({
    key, group, name,
    runs: results.length,
    passed: results.filter((r) => r.success).length,
    since: results.reduce((oldest, r) => (oldest === null || Date.parse(r.timestamp) < Date.parse(oldest) ? r.timestamp : oldest), null),
  }))
  return {
    generatedAt: new Date(now).toISOString(),
    statusUrl,
    sla: SLA,
    windows: spans.map((w) => ({ id: w.id, label: w.label, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() })),
    checks,
    suites,
  }
}

const percent = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(3)} %`)
const flagged = (value) => `${percent(value)}${value !== null && value !== undefined && value < SLA ? " **below 95 %**" : ""}`

/** One window's cell: the uptime, flagged below the SLA, and the coverage when it is partial. */
function cell(result) {
  if (result.uptime === null) return "no data"
  const partial = result.coverage < 0.999 ? ` (${(result.coverage * 100).toFixed(1)} % observed)` : ""
  return `${flagged(result.uptime)}${partial}`
}

export function renderMarkdown(report) {
  const escape = (text) => String(text).replace(/[\\|[\]()]/g, "\\$&")
  const [last8d, monthToDate, previousMonth] = report.windows
  const lines = [
    `# Uptime, ${report.generatedAt.slice(0, 10)}`,
    "",
    `From ${report.statusUrl}, generated ${report.generatedAt}. Target: ${percent(report.sla)} per service.`,
    "",
    "Time: the share of each window a check was healthy, from its state changes. Checks: Gatus's own",
    "uptime, successful checks over all checks.",
    "",
    `| Group | Check | ${last8d.label} | ${monthToDate.label} | ${previousMonth.label} | Checks 24 h | Checks 7 d | Checks 30 d |`,
    "|---|---|---|---|---|---|---|---|",
    ...report.checks.map((c) =>
      `| ${escape(c.group)} | ${escape(c.name)} | ${cell(c.time.last8d)} | ${cell(c.time.monthToDate)} | ${cell(c.time.previousMonth)} | ${flagged(c.gatus["24h"])} | ${flagged(c.gatus["7d"])} | ${flagged(c.gatus["30d"])} |`),
    "",
    "## Downtime in the last 8 days",
    "",
  ]
  const outages = report.checks.flatMap((c) => c.time.last8d.outages.map((o) => ({ ...o, check: `${c.group} / ${c.name}` })))
  if (outages.length === 0) lines.push("None.")
  else {
    lines.push("| Check | Start | End | Minutes |", "|---|---|---|---|")
    for (const o of outages.sort((a, b) => a.start.localeCompare(b.start))) {
      lines.push(`| ${escape(o.check)} | ${o.start} | ${o.end ?? "ongoing"} | ${o.minutes} |`)
    }
  }
  lines.push("", "## Suites", "", "Gatus keeps no uptime for suites. Share of the last 100 runs that passed.", "")
  lines.push("| Group | Suite | Passed | Since |", "|---|---|---|---|")
  for (const s of report.suites) {
    lines.push(`| ${escape(s.group)} | ${escape(s.name)} | ${s.passed} of ${s.runs} | ${s.since ?? "n/a"} |`)
  }
  return `${lines.join("\n")}\n`
}

async function main() {
  const statusUrl = process.env.STATUS_URL?.trim()
  const out = process.argv[2]
  if (!statusUrl || !out) {
    console.error("uptime-export: usage: STATUS_URL=<status page URL> node tools/uptime-export.mjs <output directory>")
    process.exit(1)
  }
  const now = Date.now()
  const report = await buildReport(fetch, statusUrl, now)
  const markdown = renderMarkdown(report)
  const day = report.generatedAt.slice(0, 10)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `uptime-${day}.json`), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(out, `uptime-${day}.md`), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  console.log(`uptime-export: ${report.checks.length} checks and ${report.suites.length} suites written to ${out}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`uptime-export: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
