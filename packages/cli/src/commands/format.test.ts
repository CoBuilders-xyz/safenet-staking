import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatPercent, formatSafe, formatSpan, formatTime, renderPairs, renderTable, toJson, windowSentence,
} from "./format.js"

test("an amount prints exactly, to the last wei, grouped in thousands", () => {
  assert.equal(formatSafe(73_352_054_133_956_905_730_713_929n), "73,352,054.133956905730713929 SAFE")
  assert.equal(formatSafe(1n), "0.000000000000000001 SAFE")
})

test("an amount drops trailing zeros and the point when it is whole", () => {
  assert.equal(formatSafe(20n * 10n ** 18n), "20 SAFE")
  assert.equal(formatSafe(1_500n * 10n ** 15n), "1.5 SAFE")
  assert.equal(formatSafe(0n), "0 SAFE")
})

test("a negative amount keeps its sign outside the grouping", () => {
  assert.equal(formatSafe(-1_234n * 10n ** 18n), "-1,234 SAFE")
})

test("a percentage rounds to the places asked for", () => {
  assert.equal(formatPercent(0.9765056724048157), "97.65%")
  assert.equal(formatPercent(0.9999684428104832, 3), "99.997%")
  assert.equal(formatPercent(0.05), "5.00%")
})

test("a time prints to the minute in UTC", () => {
  assert.equal(formatTime(new Date("2026-10-04T21:12:45.123Z")), "2026-10-04 21:12 UTC")
})

test("the window sentence names both edges, the publish time and the commit", () => {
  const s = windowSentence({
    days: 14,
    start: new Date("2026-09-20T21:00:00Z"),
    end: new Date("2026-10-04T21:00:00Z"),
    publishedAt: new Date("2026-10-04T21:12:45Z"),
    commit: "abcdef0123456789",
  })
  assert.equal(
    s,
    "14-day window, 2026-09-20 21:00 UTC to 2026-10-04 21:00 UTC: SEF published at " +
      "2026-10-04 21:12 UTC (commit abcdef0), floored to the hour",
  )
})

test("an unknown window says so and why, and still states its length", () => {
  const s = windowSentence({
    days: 14, start: null, end: null, publishedAt: null, commit: null,
    unknownBecause: "the GitHub API answered HTTP 403",
  })
  assert.equal(
    s,
    "14-day window ending at SEF's last publish; its time is unknown because the GitHub API answered HTTP 403",
  )
})

test("a table pads each column to its widest cell and right-aligns where asked", () => {
  const out = renderTable(
    [{ header: "NAME" }, { header: "AMOUNT", align: "right" }],
    [["a", "1 SAFE"], ["longer", "1,000 SAFE"]],
  )
  assert.equal(out, ["NAME        AMOUNT", "a           1 SAFE", "longer  1,000 SAFE"].join("\n"))
})

test("a table leaves no trailing spaces when the last cell is short", () => {
  const out = renderTable([{ header: "A" }, { header: "LONG HEADER" }], [["x", ""]])
  for (const line of out.split("\n")) assert.equal(line, line.trimEnd())
})

test("pairs align their labels", () => {
  assert.equal(renderPairs([["a", "1"], ["bbb", "2"]]), "a    1\nbbb  2")
})

test("JSON turns bigints into decimal strings and dates into ISO 8601", () => {
  const parsed = JSON.parse(toJson({ wei: 10n ** 24n, at: new Date("2026-10-04T00:00:00Z"), n: 1 }))
  assert.deepEqual(parsed, { wei: "1000000000000000000000000", at: "2026-10-04T00:00:00.000Z", n: 1 })
})

test("a span reads in days and hours, hours and minutes, or minutes", () => {
  const t = new Date("2026-10-04T00:00:00Z")
  const after = (ms: number) => new Date(t.getTime() + ms)
  assert.equal(formatSpan(t, after(26 * 3_600_000 + 5 * 60_000)), "1d 2h")
  assert.equal(formatSpan(t, after(93 * 60_000)), "1h 33m")
  assert.equal(formatSpan(t, after(5 * 60_000)), "5m")
  assert.equal(formatSpan(t, after(-60_000)), "now")
})
