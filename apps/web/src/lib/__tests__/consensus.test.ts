import { describe, it, expect } from "vitest"
import type { ConsensusWindowQuery } from "@/graphql/gnosis/generated"
import {
  CONSENSUS_WINDOW_DAYS,
  consensusWindowSince,
  deriveConsensusWindow,
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

describe("utcDayStart and consensusWindowSince", () => {
  it("floors to UTC midnight", () => {
    expect(utcDayStart(NOON)).toBe(TODAY)
  })

  it("asks for one day more than the window, so the first can be dropped", () => {
    expect(consensusWindowSince(NOON)).toBe(TODAY - (CONSENSUS_WINDOW_DAYS + 1) * DAY)
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
})
