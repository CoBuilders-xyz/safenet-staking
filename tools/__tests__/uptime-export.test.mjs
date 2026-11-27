// uptime-export.mjs against fixed events and a fake Gatus API. No network.
import { test } from "node:test"
import assert from "node:assert/strict"
import { availability, buildReport, renderMarkdown, windows } from "../uptime-export.mjs"

const T = (iso) => Date.parse(iso)
const event = (type, timestamp) => ({ type, timestamp })
const FROM = T("2026-11-01T00:00:00Z")
const TO = T("2026-11-02T00:00:00Z")

test("a check healthy all window long has full uptime and full coverage", () => {
  const result = availability([event("START", "2026-10-01T00:00:00Z"), event("HEALTHY", "2026-10-01T00:00:00Z")], FROM, TO)
  assert.equal(result.uptime, 1)
  assert.equal(result.coverage, 1)
  assert.deepEqual(result.outages, [])
})

test("counts the time between UNHEALTHY and the next HEALTHY as downtime", () => {
  const result = availability([
    event("START", "2026-10-01T00:00:00Z"),
    event("HEALTHY", "2026-10-01T00:00:00Z"),
    event("UNHEALTHY", "2026-11-01T06:00:00Z"),
    event("HEALTHY", "2026-11-01T07:12:00Z"),
  ], FROM, TO)
  assert.equal(result.downMs, 72 * 60_000)
  assert.equal(result.uptime, 1 - 72 / (24 * 60))
  assert.deepEqual(result.outages, [{ start: "2026-11-01T06:00:00.000Z", end: "2026-11-01T07:12:00.000Z", minutes: 72 }])
})

test("clips an outage that began before the window, and reads its state from a truncated history", () => {
  // Gatus dropped older events: the oldest kept is HEALTHY, so before it the check was down.
  const result = availability([event("HEALTHY", "2026-11-01T01:00:00Z")], FROM, TO)
  assert.equal(result.coverage, 1)
  assert.deepEqual(result.outages, [{ start: "2026-11-01T00:00:00.000Z", end: "2026-11-01T01:00:00.000Z", minutes: 60 }])
})

test("observes nothing before START, and says how much of the window it covers", () => {
  const result = availability([event("START", "2026-11-01T12:00:00Z"), event("HEALTHY", "2026-11-01T12:00:00Z")], FROM, TO)
  assert.equal(result.uptime, 1)
  assert.equal(result.coverage, 0.5)
})

test("has no uptime for a window with no observation", () => {
  assert.equal(availability([], FROM, TO).uptime, null)
  assert.equal(availability([event("START", "2026-12-01T00:00:00Z")], FROM, TO).uptime, null)
})

test("marks an outage ongoing only when nothing follows it", () => {
  const down = [event("START", "2026-10-01T00:00:00Z"), event("UNHEALTHY", "2026-11-01T23:00:00Z")]
  assert.equal(availability(down, FROM, TO).outages[0].end, null)
  const recovered = [...down, event("HEALTHY", "2026-11-02T01:00:00Z")]
  assert.equal(availability(recovered, FROM, TO).outages[0].end, "2026-11-02T00:00:00.000Z")
})

test("windows: the last 8 days, the month to date and the previous month, in UTC", () => {
  const [last8d, monthToDate, previousMonth] = windows(T("2026-12-07T10:00:00Z"))
  assert.equal(new Date(last8d.from).toISOString(), "2026-11-29T10:00:00.000Z")
  assert.equal(new Date(monthToDate.from).toISOString(), "2026-12-01T00:00:00.000Z")
  assert.deepEqual([previousMonth.label, new Date(previousMonth.from).toISOString(), new Date(previousMonth.to).toISOString()],
    ["2026-11", "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"])
  assert.equal(windows(T("2027-01-03T00:00:00Z"))[2].label, "2026-12")
})

/** A fake Gatus: one endpoint down for an hour, and one suite. Records each URL asked. */
function fakeGatus() {
  const asked = []
  const routes = {
    "/api/v1/endpoints/statuses?page=1&pageSize=1": [{ key: "web_web-app", name: "Web app", group: "Web" }],
    "/api/v1/endpoints/web_web-app/uptimes/24h": "1",
    "/api/v1/endpoints/web_web-app/uptimes/7d": "0.99",
    "/api/v1/endpoints/web_web-app/uptimes/30d": "0.9",
    "/api/v1/endpoints/web_web-app/statuses?page=1&pageSize=1": {
      events: [event("START", "2026-10-01T00:00:00Z"), event("HEALTHY", "2026-10-01T00:00:00Z"),
        event("UNHEALTHY", "2026-12-06T10:00:00Z"), event("HEALTHY", "2026-12-06T11:00:00Z")],
    },
    "/api/v1/suites/statuses": [{ key: "web_same", name: "Same | release", group: "Web", results: [
      { success: true, timestamp: "2026-12-07T09:00:00Z" }, { success: false, timestamp: "2026-12-07T09:05:00Z" }] }],
  }
  const fetch = async (url) => {
    const path = url.slice("https://status.example.test".length)
    asked.push(path)
    const body = routes[path]
    if (body === undefined) return new Response("not found", { status: 404 })
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 })
  }
  return { fetch, asked }
}

test("buildReport reads each endpoint's uptimes and events, and each suite", async () => {
  const { fetch } = fakeGatus()
  const report = await buildReport(fetch, "https://status.example.test", T("2026-12-07T10:00:00Z"))
  assert.equal(report.checks.length, 1)
  const [check] = report.checks
  assert.deepEqual(check.gatus, { "24h": 1, "7d": 0.99, "30d": 0.9 })
  assert.equal(check.time.last8d.outages[0].minutes, 60)
  assert.equal(check.time.previousMonth.uptime, 1)
  assert.deepEqual(report.suites, [{ key: "web_same", group: "Web", name: "Same | release", runs: 2, passed: 1, since: "2026-12-07T09:00:00Z" }])
})

test("buildReport fails when the status page does not answer", async () => {
  const fetch = async () => new Response("", { status: 502 })
  await assert.rejects(buildReport(fetch, "https://status.example.test", Date.now()), /answered 502/)
})

test("renderMarkdown flags a window below 95 %, lists downtime, and escapes names", async () => {
  const { fetch } = fakeGatus()
  const report = await buildReport(fetch, "https://status.example.test", T("2026-12-07T10:00:00Z"))
  report.checks[0].time.monthToDate.uptime = 0.9
  const text = renderMarkdown(report)
  assert.match(text, /90\.000 % \*\*below 95 %\*\*/)
  assert.match(text, /\| Web \/ Web app \| 2026-12-06T10:00:00.000Z \| 2026-12-06T11:00:00.000Z \| 60 \|/)
  assert.match(text, /\| Web \| Same \\\| release \| 1 of 2 \|/)
})
