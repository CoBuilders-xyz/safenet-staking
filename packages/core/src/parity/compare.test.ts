import { test } from "node:test"
import assert from "node:assert/strict"
import type { SefValidator } from "../sef.js"
import {
  EXIT_CODE, agrees, compareAmount, compareParticipation, compareStakedTotal, formatAge, freshness,
  NEEDS_HOURLY_BUCKETS, SEF_PUBLISHES_NO_RATE, lacksHourlyBuckets, notComparable, overall, parseLastCommit,
  participationFromHours, renderMarkdown, renderText, sefRunSpan, staleOutcome, totalsBetween,
} from "./compare.js"

// Made-up validators. The addresses are test fixtures, not contracts.
const A = "0x00000000000000000000000000000000000000aa"
const B = "0x00000000000000000000000000000000000000bb"
const validator = (address: string, label: string, rate: number): SefValidator => ({
  address, label, participation_rate_14d: rate, commission: 0.05, is_active: true,
})

// SEF publishes the quotient as a double, so the fixture is the same division.
const CEREMONIES = 31_153n
const SEF = [validator(A, "Alpha", 30_412 / 31_153), validator(B, "Bravo", 31_152 / 31_153)]
const attended = (a: bigint, b: bigint) => new Map([[A, a], [B, b]])

test("identical counts reproduce SEF's doubles and pass", () => {
  const rows = compareParticipation({ sef: SEF, attended: attended(30_412n, 31_152n), ceremonies: CEREMONIES })
  assert.deepEqual(rows.map((r) => r.verdict), ["PASS", "PASS"])
  assert.equal(rows[0]!.ours, rows[0]!.sef)
  assert.equal(rows[0]!.precision, "exact")
  assert.equal(rows[0]!.note, "30412 / 31153")
  assert.equal(overall(rows), "PASS")
})

test("one differing validator fails, and the row names it", () => {
  const rows = compareParticipation({ sef: SEF, attended: attended(30_412n, 31_151n), ceremonies: CEREMONIES })
  const failed = rows.filter((r) => r.verdict === "FAIL")
  assert.equal(failed.length, 1)
  assert.match(failed[0]!.figure, /^Bravo /)
  assert.equal(overall(rows), "FAIL")
  assert.match(renderText(rows), /Bravo participation_rate_14d .* FAIL/)
})

test("a single ceremony of difference is not hidden by an exact comparison", () => {
  // One ceremony in 31,153 moves the rate by 3e-5: invisible at four places, a failure here.
  const rows = compareParticipation({ sef: SEF, attended: attended(30_413n, 31_152n), ceremonies: CEREMONIES })
  assert.equal(rows[0]!.verdict, "FAIL")
})

test("a declared rounding is compared at SEF's precision, and says so", () => {
  const rounded = [validator(A, "Alpha", 0.9762), validator(B, "Bravo", 1)]
  const rows = compareParticipation({
    sef: rounded, attended: attended(30_412n, 31_152n), ceremonies: CEREMONIES, precision: { decimals: 4 },
  })
  // 30412 / 31153 = 0.976214... rounds to 0.9762; 31152 / 31153 = 0.999968 rounds to 1.0000.
  assert.deepEqual(rows.map((r) => r.verdict), ["PASS", "PASS"])
  assert.equal(rows[0]!.precision, "4 decimals")
  // The same rounded file compared exactly fails: the tolerance is only what was declared.
  const exact = compareParticipation({ sef: rounded, attended: attended(30_412n, 31_152n), ceremonies: CEREMONIES })
  assert.deepEqual(exact.map((r) => r.verdict), ["FAIL", "FAIL"])
})

test("the rounding tolerance is half a unit in the last place, no more", () => {
  assert.equal(agrees(0.97625, 0.9762, { decimals: 4 }), true)
  assert.equal(agrees(0.97626, 0.9762, { decimals: 4 }), false)
  assert.equal(agrees(Number.NaN, Number.NaN, "exact"), false)
})

test("a signer SEF does not list fails, and a validator with no attendance reads zero", () => {
  const stranger = "0x00000000000000000000000000000000000000cc"
  const rows = compareParticipation({
    sef: SEF, attended: new Map([[A, 30_412n], [stranger, 5n]]), ceremonies: CEREMONIES,
  })
  assert.equal(rows[1]!.ours, "0")
  assert.equal(rows[1]!.verdict, "FAIL")
  assert.ok(rows.some((r) => r.figure.startsWith(stranger) && r.verdict === "FAIL"))
})

test("a window with no ceremonies fails rather than dividing by zero", () => {
  const rows = compareParticipation({ sef: SEF, attended: attended(0n, 0n), ceremonies: 0n })
  assert.equal(overall(rows), "FAIL")
})

// validator-info.json as SEF published it at cce3fc2, 2026-10-20 09:01 UTC, and still on
// 2026-10-22: every rate null. Addresses, labels and flags copied from the file.
const LIVE_2026_10_22: SefValidator[] = [
  { address: "0x3D58a5475c1336b0A755c3aBd298CeB9b7BB9CDe", commission: 0.05, is_active: true, label: "Gnosis", participation_rate_14d: null },
  { address: "0x7B0A8EFA45dE81F11F2846EC28259B62155a2b37", commission: 0.05, is_active: true, label: "Greenfield", participation_rate_14d: null },
  { address: "0xb0E735D4a3b70195420E0ae933689A55750CFcd2", commission: 0.05, is_active: false, label: "RockawayX", participation_rate_14d: null },
  { address: "0xCc00DE0eA14c08669b26DcBFE365dBD9890B04D9", commission: 0.05, is_active: true, label: "Core Contributors", participation_rate_14d: null },
  { address: "0xD8997c2a94052C4FB79B53b3e255c1F07c99305B", commission: 0.05, is_active: false, label: "Blockchain Capital", participation_rate_14d: null },
  { address: "0xF6EA21D702983c443f58A267265912FE03D2FF0b", commission: 0.05, is_active: true, label: "Safe Labs", participation_rate_14d: null },
]

test("a null SEF rate is NOT COMPARABLE, says why, and exits 0, even over a window with no ceremonies", () => {
  for (const ceremonies of [0n, CEREMONIES]) {
    const rows = compareParticipation({ sef: LIVE_2026_10_22, attended: new Map(), ceremonies })
    assert.equal(rows.length, 6)
    assert.ok(rows.every((r) => r.verdict === "NOT COMPARABLE" && r.note === SEF_PUBLISHES_NO_RATE))
    assert.equal(rows[2]!.figure, "RockawayX participation_rate_14d")
    const state = overall(rows)
    assert.equal(state, "NOT COMPARABLE")
    assert.equal(EXIT_CODE[state], 0)
  }
})

test("a null rate beside a published one still compares the published one", () => {
  const mixed = [validator(A, "Alpha", 30_412 / 31_153), { ...validator(B, "Bravo", 0), participation_rate_14d: null }]
  const pass = compareParticipation({ sef: mixed, attended: attended(30_412n, 31_152n), ceremonies: CEREMONIES })
  assert.deepEqual(pass.map((r) => r.verdict), ["PASS", "NOT COMPARABLE"])
  const fail = compareParticipation({ sef: mixed, attended: attended(30_413n, 31_152n), ceremonies: CEREMONIES })
  assert.equal(overall(fail), "FAIL")
  // With a rate published, a window the subgraph counts no ceremony in still fails.
  assert.equal(overall(compareParticipation({ sef: mixed, attended: new Map(), ceremonies: 0n })), "FAIL")
})

test("amounts compare to the wei", () => {
  const sef = 73_352_054_133_956_905_730_713_929n
  assert.equal(compareAmount("total_staked_amount", sef, sef).verdict, "PASS")
  const off = compareAmount("total_staked_amount", sef + 1n, sef)
  assert.equal(off.verdict, "FAIL")
  assert.equal(off.note, "differs by 1")
})

// --------------------------------------------------------------------- the staked total

// The total is 1,000 at block 140. A stake of 30 landed at block 105, a withdrawal of 20 at
// block 110 and a stake of 5 at block 130, after SEF's commit at block 112.
const MOVES = [{ block: 105n, delta: 30n }, { block: 110n, delta: -20n }, { block: 130n, delta: 5n }]
const totals = totalsBetween({ at: 140n, total: 1_000n, movements: MOVES, from: 100n, to: 112n })

test("the total is rewound exactly through every later movement", () => {
  assert.deepEqual(totals, [
    { block: 100n, total: 985n },
    { block: 105n, total: 1_015n },
    { block: 110n, total: 995n },
  ])
})

test("SEF's total at its commit block passes", () => {
  const row = compareStakedTotal(995n, totals, 112n)
  assert.equal(row.verdict, "PASS")
  assert.match(row.note!, /at block 112, SEF's commit/)
})

test("SEF's total read before a movement inside its run passes, and says where", () => {
  const row = compareStakedTotal(1_015n, totals, 112n)
  assert.equal(row.verdict, "PASS")
  assert.match(row.note!, /at block 105: SEF read the chain before the movement at block 110/)
})

test("a total no block in the span held fails, with the difference at the commit", () => {
  const row = compareStakedTotal(996n, totals, 112n)
  assert.equal(row.verdict, "FAIL")
  assert.match(row.note!, /differs by -1/)
})

test("a movement at or before the span's start is refused rather than double counted", () => {
  assert.throws(() => totalsBetween({ at: 140n, total: 1n, movements: [{ block: 100n, delta: 1n }], from: 100n, to: 112n }))
})

test("a table where nothing was compared is not a pass", () => {
  assert.equal(overall([{ figure: "x", ours: "", sef: "", precision: "exact", verdict: "NOT COMPARED" }]), "FAIL")
})

test("the Markdown table escapes pipes and keeps one row per figure", () => {
  const md = renderMarkdown([{ figure: "a|b", ours: "1", sef: "1", precision: "exact", verdict: "PASS" }])
  assert.equal(md.split("\n").length, 3)
  assert.match(md, /a\\\|b/)
})

// -------------------------------------------------------------------------- the stale rule

const PUBLISHED = new Date("2026-10-05T06:04:11Z")
const after = (hours: number) => new Date(PUBLISHED.getTime() + hours * 3_600_000)

test("8 hours after SEF's publish the data is fresh", () => {
  assert.equal(freshness(PUBLISHED, after(8)).state, "fresh")
})

test("10 hours after SEF's publish the data is stale, which is not a failure", () => {
  assert.equal(freshness(PUBLISHED, after(10)).state, "stale")
})

test("25 hours after SEF's publish the data has expired", () => {
  assert.equal(freshness(PUBLISHED, after(25)).state, "expired")
})

test("each state has its exit code, and only FAIL exits 1", () => {
  assert.deepEqual(EXIT_CODE, { "PASS": 0, "FAIL": 1, "STALE": 0, "NOT COMPARABLE": 0 })
  assert.equal(staleOutcome(freshness(PUBLISHED, after(8)), "f.json"), undefined)
  const stale = staleOutcome(freshness(PUBLISHED, after(10)), "f.json")!
  assert.equal(stale.state, "STALE")
  assert.equal(EXIT_CODE[stale.state], 0)
  assert.match(stale.line, /^STALE: f\.json was last written 10 h 0 min ago, more than 9 h/)
  const expired = staleOutcome(freshness(PUBLISHED, after(25)), "f.json")!
  assert.equal(expired.state, "FAIL")
  assert.equal(EXIT_CODE[expired.state], 1)
  assert.match(expired.line, /^FAIL: SEF's data is stale\./)
})

// graph-node's answer to a query for a field the schema lacks, as the Gnosis deployment
// 2a0e6b8, built before the hourly buckets, answered it on 2026-10-05.
const NO_BUCKETS = "Type `Query` has no field `consensusHours`"

test("a deployment without hourly buckets is NOT COMPARABLE, exits 0, and says why in one line", () => {
  assert.equal(lacksHourlyBuckets(`the gnosis subgraph: ${NO_BUCKETS}`), true)
  const rows = [
    notComparable("participation_rate_14d", `this deployment has no hourly buckets; ${NEEDS_HOURLY_BUCKETS}`),
    { figure: "total_transactions_checked", ours: "", sef: "980515", precision: "", verdict: "NOT COMPARED" as const },
  ]
  const state = overall(rows)
  assert.equal(state, "NOT COMPARABLE")
  assert.equal(EXIT_CODE[state], 0)
})

test("another subgraph error is not mistaken for missing buckets", () => {
  assert.equal(lacksHourlyBuckets("the gnosis subgraph answered HTTP 502; check SUBGRAPH_URL_GNOSIS"), false)
  assert.equal(lacksHourlyBuckets("Type `Query` has no field `validatorHourz`"), false)
})

// ------------------------------------------------------------------------- hourly buckets

// A window of two hours, from 03:00 to 05:00 on 2026-04-02, both ends included.
const H = Date.UTC(2026, 3, 2, 3) / 1000
const TWO_HOURS = { start: new Date(H * 1000), end: new Date((H + 7200) * 1000) }
const hour = (h: number, whole: number, onTheHour = 0) =>
  ({ hour: h, attestationCeremonies: whole, attestationCeremoniesOnTheHour: onTheHour })
const vhour = (validator: string, h: number, attended: number, onTheHour = 0) =>
  ({ validator, hour: h, attended, attendedOnTheHour: onTheHour })

test("the window is the whole hours before its end plus the block exactly at the end", () => {
  const { ceremonies, attended } = participationFromHours({
    window: TWO_HOURS,
    consensus: [
      hour(H - 3600, 100, 1), // before the window
      hour(H, 300, 2), // whole: its block on the hour is the window's first
      hour(H + 3600, 290, 1),
      hour(H + 7200, 310, 1), // only the block on the hour: the window's last
      hour(H + 10800, 305, 0), // after the window
    ],
    validators: [
      vhour(A, H - 3600, 99, 1), vhour(A, H, 299, 2), vhour(A, H + 3600, 290, 1), vhour(A, H + 7200, 300, 1),
      vhour(B.toUpperCase().replace("0X", "0x"), H, 250, 0), vhour(B, H + 7200, 310, 0),
    ],
  })
  assert.equal(ceremonies, 300n + 290n + 1n)
  assert.equal(attended.get(A), 299n + 290n + 1n)
  // Ids are compared lower-case; B attended nothing in the end block itself.
  assert.equal(attended.get(B), 250n)
})

test("an hour with no row counted nothing", () => {
  const { ceremonies, attended } = participationFromHours({ window: TWO_HOURS, consensus: [hour(H + 3600, 5)], validators: [] })
  assert.equal(ceremonies, 5n)
  assert.equal(attended.size, 0)
})

test("a window or a row off the hour is refused rather than rounded", () => {
  const off = { start: new Date((H + 1) * 1000), end: TWO_HOURS.end }
  assert.throws(() => participationFromHours({ window: off, consensus: [], validators: [] }), /start is not on the hour/)
  assert.throws(() => participationFromHours({ window: TWO_HOURS, consensus: [hour(H + 5, 1)], validators: [] }), /not on the hour: /)
  assert.throws(
    () => participationFromHours({ window: { start: TWO_HOURS.end, end: TWO_HOURS.start }, consensus: [], validators: [] }),
    /ends before it starts/,
  )
})

test("the hourly sum feeds the same exact comparison", () => {
  const { ceremonies, attended } = participationFromHours({
    window: TWO_HOURS,
    consensus: [hour(H, 31_000), hour(H + 3600, 153), hour(H + 7200, 99, 0)],
    validators: [vhour(A, H, 30_300), vhour(A, H + 3600, 112), vhour(B, H, 30_999), vhour(B, H + 3600, 153)],
  })
  const rows = compareParticipation({ sef: SEF, attended, ceremonies })
  assert.equal(ceremonies, CEREMONIES)
  assert.deepEqual(rows.map((r) => r.verdict), ["PASS", "PASS"])
})

test("a real mismatch still fails next to a figure that is not comparable", () => {
  const mismatch = compareAmount("total_staked_amount, wei", 2n, 1n)
  const state = overall([notComparable("x", "y"), mismatch])
  assert.equal(state, "FAIL")
  assert.equal(EXIT_CODE[state], 1)
})

test("the thresholds sit at exactly 9 and 24 hours", () => {
  assert.equal(freshness(PUBLISHED, after(9)).state, "fresh")
  assert.equal(freshness(PUBLISHED, after(24)).state, "stale")
  assert.equal(formatAge(after(10.5).getTime() - PUBLISHED.getTime()), "10 h 30 min")
})

// ---------------------------------------------------------------------- the publish instant

// The shape of the GitHub commits API answer, trimmed to the fields read.
const SHA = "4f1c2a9e0b7d6c5f4e3d2c1b0a9f8e7d6c5b4a39"
const commits = [{
  sha: SHA,
  commit: { author: { date: "2026-10-05T06:03:58Z" }, committer: { date: "2026-10-05T06:04:11Z" } },
}]

test("the publish instant is the committer date of the last commit", () => {
  const c = parseLastCommit(commits)
  assert.equal(c.sha, SHA)
  assert.equal(c.publishedAt.toISOString(), "2026-10-05T06:04:11.000Z")
})

test("a rate-limit answer is reported with GitHub's message and the remedy", () => {
  assert.throws(
    () => parseLastCommit({ message: "API rate limit exceeded for 203.0.113.7." }),
    /did not return a list: API rate limit exceeded.*; .*set GITHUB_TOKEN, or sign in to gh so `gh auth token` answers/,
  )
  assert.throws(() => parseLastCommit({ message: "Bad credentials" }), /Bad credentials; check GITHUB_TOKEN/)
})

test("an empty list, a short sha or a bad date is refused", () => {
  assert.throws(() => parseLastCommit([]), /no commit/)
  assert.throws(() => parseLastCommit([{ ...commits[0], sha: "4f1c2a9" }]), /sha/)
  assert.throws(() => parseLastCommit([{ sha: SHA, commit: { committer: { date: "yesterday" } } }]), /date/)
})

test("SEF's run span starts at the top of the commit's hour and ends at the commit", () => {
  const { from, to } = sefRunSpan(PUBLISHED)
  assert.equal(from.toISOString(), "2026-10-05T06:00:00.000Z")
  assert.equal(to.getTime(), PUBLISHED.getTime())
})
