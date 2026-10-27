import { describe, it, expect } from "vitest"
import type { ConsensusWindowQuery } from "@/graphql/gnosis/generated"
import { AEGIS_START_DAY, BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import {
  CONSENSUS_QUERY_DAYS,
  CONSENSUS_WINDOW_DAYS,
  consensusQueryVariables,
  deriveConsensusWindow,
  describesBeta,
  histogramQuantile,
  utcDayStart,
} from "../consensus"

const DAY = 86_400
const TODAY = 1_791_072_000 // 2026-10-04 00:00 UTC
const NOON = (TODAY + DAY / 2) * 1000
const A = "0x00000000000000000000000000000000000000aa"
const B = "0x00000000000000000000000000000000000000bb"

function day(offset: number, attestations: number, ceremonies: number, buckets: number[] = []) {
  return {
    date: TODAY + offset * DAY,
    attestations: String(attestations),
    attestationCeremonies: String(ceremonies),
    latencyBuckets: buckets.map(String),
  }
}

function query(overrides: Partial<ConsensusWindowQuery> = {}): ConsensusWindowQuery {
  return {
    _meta: { block: { number: 1, timestamp: TODAY }, hasIndexingErrors: false },
    firstDay: [{ date: TODAY - 3 * DAY }],
    consensusDays: [
      day(-3, 100, 10), // the first indexed day: partial, dropped
      day(-2, 4000, 400, [0, 1, 2]),
      day(-1, 5000, 500, [0, 0, 1]),
      day(0, 50, 5), // today: still running, dropped
    ],
    validatorDays: [
      { date: TODAY - 3 * DAY, attended: "10", validator: { id: A } },
      { date: TODAY - 2 * DAY, attended: "400", validator: { id: A } },
      { date: TODAY - 1 * DAY, attended: "500", validator: { id: A } },
      { date: TODAY - 2 * DAY, attended: "300", validator: { id: B } },
      { date: TODAY, attended: "5", validator: { id: B } },
    ],
    ...overrides,
  }
}

describe("utcDayStart and consensusQueryVariables", () => {
  it("floors to UTC midnight", () => {
    expect(utcDayStart(NOON)).toBe(TODAY)
  })

  it("reads Beta's rows up to its last day", () => {
    expect(consensusQueryVariables("beta")).toEqual({ days: CONSENSUS_QUERY_DAYS, until: utcDayMs(BETA_END_DAY) / 1000, programme: "beta" })
  })

  it("reads Aegis's rows with no date bound, and Aegis by default", () => {
    expect(consensusQueryVariables("aegis")).toEqual({ days: CONSENSUS_QUERY_DAYS, until: 2_147_483_647, programme: "aegis" })
    expect(consensusQueryVariables()).toEqual(consensusQueryVariables("aegis"))
  })
})

describe("histogramQuantile", () => {
  it("matches the metrics rule, sorted[min(n - 1, floor(n * p))]", () => {
    // Samples 0, 1, 1, 2, 2, 2: n = 6, the median index is 3, which holds a 2.
    expect(histogramQuantile([1n, 2n, 3n], 0.5)).toBe(2)
    // Five samples of 5 blocks and one of 9.
    const buckets = Array.from({ length: 10 }, (_, i) => (i === 5 ? 5n : i === 9 ? 1n : 0n))
    expect(histogramQuantile(buckets, 0.5)).toBe(5)
    expect(histogramQuantile(buckets, 0.95)).toBe(9)
  })

  it("is undefined with no samples", () => {
    expect(histogramQuantile([0n, 0n], 0.5)).toBeUndefined()
  })
})

describe("deriveConsensusWindow", () => {
  it("counts complete days only: not today, and not the first indexed day", () => {
    const w = deriveConsensusWindow(query(), NOON)!
    expect(w.days).toBe(2)
    expect(w.from).toBe(TODAY - 2 * DAY)
    expect(w.to).toBe(TODAY - DAY)
    expect(w.attestationsPerDay).toEqual({ mean: 4500, min: 4000, max: 5000 })
    expect(w.ceremonies).toBe(900n)
  })

  it("takes the latency median over the counted days", () => {
    // Buckets summed: [0, 1, 3], so samples 1, 2, 2, 2 and the median index 2 holds a 2.
    expect(deriveConsensusWindow(query(), NOON)!.latencyMedianBlocks).toBe(2)
  })

  it("derives participation from the same days, with absences", () => {
    const p = deriveConsensusWindow(query(), NOON)!.participation!
    expect(p.get(A)).toEqual({ rate: 1, attended: 900n, absences: 0n })
    expect(p.get(B)?.attended).toBe(300n)
    expect(p.get(B)?.absences).toBe(600n)
    expect(p.get(B)?.rate).toBeCloseTo(1 / 3, 9)
  })

  it("keeps at most the window's number of days", () => {
    const many = Array.from({ length: 20 }, (_, i) => day(-20 + i, 1000 + i, 100))
    const w = deriveConsensusWindow(query({ firstDay: [{ date: TODAY - 30 * DAY }], consensusDays: many }), NOON)!
    expect(w.days).toBe(CONSENSUS_WINDOW_DAYS)
    expect(w.to).toBe(TODAY - DAY)
  })

  it("is undefined when no complete day remains, as on a subgraph a day old", () => {
    expect(
      deriveConsensusWindow(query({ firstDay: [{ date: TODAY - DAY }], consensusDays: [day(-1, 10, 1), day(0, 10, 1)] }), NOON),
    ).toBeUndefined()
  })

  it("drops participation when the page limit may have cut rows off", () => {
    const rows = Array.from({ length: 1000 }, () => ({ date: TODAY - DAY, attended: "1", validator: { id: A } }))
    expect(deriveConsensusWindow(query({ validatorDays: rows }), NOON)!.participation).toBeUndefined()
  })

  it("keeps participation from a full page that reaches back past the window's first day", () => {
    // Newest first, as the query orders them: the window's two days, then older rows to fill the page.
    const rows = [
      { date: TODAY - DAY, attended: "500", validator: { id: A } },
      { date: TODAY - 2 * DAY, attended: "400", validator: { id: A } },
      ...Array.from({ length: 998 }, () => ({ date: TODAY - 3 * DAY, attended: "1", validator: { id: B } })),
    ]
    const p = deriveConsensusWindow(query({ validatorDays: rows }), NOON)!.participation!
    expect(p.get(A)?.attended).toBe(900n)
    expect(p.has(B)).toBe(false)
  })

  it("ends at the last day the subgraph holds, so a network that stopped keeps its figures", () => {
    // Nothing indexed for a month: the window is still the last complete days there are.
    const w = deriveConsensusWindow(
      query({ consensusDays: [day(-32, 1, 1), day(-31, 4000, 400, [1]), day(-30, 10, 1, [1])], firstDay: [{ date: TODAY - 32 * DAY }] }),
      NOON,
    )!
    expect(w.from).toBe(TODAY - 31 * DAY)
    expect(w.to).toBe(TODAY - 30 * DAY)
    expect(w.lastCeremonyDay).toBe(TODAY - 30 * DAY)
  })

  it("names the last counted day with a ceremony, skipping days without one", () => {
    const w = deriveConsensusWindow(query({ consensusDays: [day(-3, 1, 1), day(-2, 4000, 400), day(-1, 0, 0), day(0, 0, 0)] }), NOON)!
    expect(w.to).toBe(TODAY - DAY)
    expect(w.lastCeremonyDay).toBe(TODAY - 2 * DAY)
  })
})

describe("the window at the end of Beta", () => {
  // Days counted from the core calendar, in unix seconds; no programme date is typed here.
  const END = utcDayMs(BETA_END_DAY) / 1000
  const START = utcDayMs(AEGIS_START_DAY) / 1000
  /** The stray ceremony the Beta contract recorded after Beta ended: chain data, not a programme date. */
  const STRAY = Date.parse("2026-10-06T00:00:00Z") / 1000
  const noonOf = (date: number) => (date + DAY / 2) * 1000
  const row = (date: number, attestations: number) => ({
    date,
    attestations: String(attestations),
    attestationCeremonies: String(attestations),
    latencyBuckets: ["0", "1"],
  })
  const checked = noonOf(END + 3 * DAY)
  // Beta's last 14 days at 4,000, its last day at 1,210, then the stray ceremony.
  const beta = Array.from({ length: 13 }, (_, i) => row(END - (13 - i) * DAY, 4000))
  const lastDays = { firstDay: [{ date: END - 14 * DAY }], validatorDays: [], consensusDays: [...beta, row(END, 1210), row(STRAY, 1)] }

  it("drops a gap day: the window ends on Beta's last day and the stray is not in the range", () => {
    const w = deriveConsensusWindow(query(lastDays), checked, "beta")!
    expect(w.from).toBe(END - 13 * DAY)
    expect(w.to).toBe(END)
    expect(w.days).toBe(14)
    expect(w.attestationsPerDay.min).toBe(1210)
    expect(w.attestationsPerDay.max).toBe(4000)
    expect(w.lastCeremonyDay).toBe(END)
  })

  it("drops a stray on the Beta contract dated after Aegis started", () => {
    const after = START + 7 * DAY
    const w = deriveConsensusWindow(query({ ...lastDays, consensusDays: [...lastDays.consensusDays, row(after, 1)] }), noonOf(after + 2 * DAY), "beta")!
    expect(w.to).toBe(END)
    expect(w.attestationsPerDay.min).toBe(1210)
    expect(describesBeta(w.lastCeremonyDay, "beta")).toBe(true)
  })

  it("counts only consecutive calendar days: a day with no row inside them is not counted", () => {
    // Rows a week apart: the 14 calendar days ending on the newest row hold only two of them.
    const sparse = [34, 27, 20, 13, 6].map((n) => row(END - n * DAY, 3000))
    const w = deriveConsensusWindow(query({ firstDay: [{ date: END - 60 * DAY }], validatorDays: [], consensusDays: sparse }), checked)!
    expect(w.from).toBe(END - 13 * DAY)
    expect(w.to).toBe(END - 6 * DAY)
    expect(w.days).toBe(2)
  })

  it("keeps Aegis days once the subgraph indexes the Aegis contracts", () => {
    const days = [row(START + DAY, 5000), row(START + 2 * DAY, 5100)]
    const w = deriveConsensusWindow(query({ ...lastDays, consensusDays: days }), noonOf(START + 3 * DAY), "aegis")!
    expect(w.to).toBe(START + 2 * DAY)
  })
})

describe("describesBeta", () => {
  const seconds = (ms: number) => ms / 1000

  it("is true while the subgraph indexes Beta, even for a row dated in Aegis", () => {
    expect(describesBeta(seconds(utcDayMs(BETA_END_DAY)))).toBe(true)
    expect(describesBeta(seconds(utcDayMs(AEGIS_START_DAY)) + 7 * DAY, "beta")).toBe(true)
  })

  it("once Aegis is indexed, is true while the last day is in Beta or the gap, or there is no ceremony", () => {
    expect(describesBeta(seconds(utcDayMs(BETA_END_DAY)), "aegis")).toBe(true)
    expect(describesBeta(seconds(utcDayMs(AEGIS_START_DAY)) - DAY, "aegis")).toBe(true)
    expect(describesBeta(undefined, "aegis")).toBe(true)
  })

  it("once Aegis is indexed, turns false when the last day is an Aegis day", () => {
    expect(describesBeta(seconds(utcDayMs(AEGIS_START_DAY)), "aegis")).toBe(false)
    expect(describesBeta(seconds(utcDayMs(AEGIS_START_DAY)) + 20 * DAY, "aegis")).toBe(false)
  })
})
