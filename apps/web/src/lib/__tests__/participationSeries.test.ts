import { describe, it, expect } from "vitest"
import { GNOSIS_AEGIS_FIRST_COMPLETE_DAY, BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { bucketProgramme, buildSeries, selectWindow, seriesFromAnswer, windowLabel, type ParticipationPoint } from "../participationSeries"
import { i18n } from "@/i18n"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

const DAY = 86_400
const HOUR = 3_600
const V = TEST_ACCOUNTS.validator1.toLowerCase()
const betaEnd = utcDayMs(BETA_END_DAY) / 1000
const first = utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000
const bucket = (start: number, count: number, programme = "aegis") => ({ id: `${programme}-${start}`, programme, start, count })

describe("bucketProgramme", () => {
  it("reads explicit programmes, prefixes, and legacy Beta ids", () => {
    expect(bucketProgramme({ id: "1791158400" })).toBe("beta")
    expect(bucketProgramme({ id: `aegis-${V}-1792800000` })).toBe("aegis")
    expect(bucketProgramme({ id: "1792800000", programme: "aegis" })).toBe("aegis")
  })
})

describe("buildSeries", () => {
  it("retains Aegis's first complete day and missing attendance for a known member", () => {
    const network = [bucket(first, 100), bucket(first + DAY, 200), bucket(first + 2 * DAY, 400)]
    const series = buildSeries(network, [bucket(first + DAY, 150)], "day", first + 3 * DAY, ["aegis"])
    expect(series.map((p) => [p.start, p.rate])).toEqual([[first, 0], [first + DAY, 0.75], [first + 2 * DAY, 0]])
  })

  it("retains silent calendar days as undefined rates, not zero participation", () => {
    const series = buildSeries([bucket(first + 2 * DAY, 100)], [], "day", first + 3 * DAY, ["aegis"])
    expect(series.map((p) => [p.ceremonies, p.rate])).toEqual([[0, null], [0, null], [100, 0]])
  })

  it("does not infer membership from attendance rows", () => {
    expect(buildSeries([bucket(first, 100)], [bucket(first, 50)], "day", first + DAY, [])).toEqual([])
  })

  it("uses indexed time and excludes partial or pre-coverage buckets", () => {
    const network = [bucket(first - HOUR, 10), bucket(first, 10), bucket(first + HOUR, 10)]
    expect(buildSeries(network, [], "hour", first + HOUR + 60, ["aegis"]).map((p) => p.start)).toEqual([first])
  })

  it("drops Beta's partial first bucket and closed-contract strays", () => {
    const days = [betaEnd - 2 * DAY, betaEnd - DAY, betaEnd, betaEnd + DAY]
    const network = days.map((d) => bucket(d, 100, "beta"))
    expect(buildSeries(network, [], "day", first, ["beta"]).map((p) => p.start)).toEqual(days.slice(1, 3))
  })

  it("rejects impossible attendance instead of drawing negative misses", () => {
    expect(() => buildSeries([bucket(first, 10)], [bucket(first, 11)], "day", first + DAY, ["aegis"])).toThrow("Invalid participation counts")
  })
})

describe("seriesFromAnswer", () => {
  const data = {
    _meta: null,
    memberships: [{ programme: "aegis", validatorCount: 1, validators: [{ id: V }] }],
    consensusDays: [{ id: `aegis-${first}`, programme: "aegis", date: first, attestationCeremonies: "100" }],
    validatorDays: [], consensusHours: [], validatorHours: [],
  }
  it("counts a known member with no attendance as zero", () => {
    expect(seriesFromAnswer(data, first + DAY, V).daily[0].rate).toBe(0)
  })
  it("does not turn missing or incomplete membership into zero", () => {
    expect(() => seriesFromAnswer({ ...data, memberships: [] }, first + DAY, V)).toThrow("Missing programme membership")
    expect(() => seriesFromAnswer({ ...data, memberships: [{ programme: "aegis", validatorCount: 2, validators: [{ id: V }] }] }, first + DAY, V)).toThrow("Incomplete programme membership")
    expect(seriesFromAnswer(data, first + DAY, TEST_ACCOUNTS.user).daily).toEqual([])
  })
})

describe("selectWindow", () => {
  const point = (start: number, attended = 9, ceremonies = 10): ParticipationPoint => ({ programme: "aegis", start, attended, ceremonies, rate: ceremonies ? attended / ceremonies : null })
  const daily = Array.from({ length: 40 }, (_, i) => point(first + i * DAY))
  const hourly = Array.from({ length: 24 * 10 }, (_, i) => point(first + i * HOUR))
  it("uses hourly buckets for 7 days, daily buckets for 30 days and all", () => {
    expect(selectWindow({ hourly, daily }, "7d")!.points).toHaveLength(168)
    expect(selectWindow({ hourly, daily }, "30d")!.points).toHaveLength(30)
    expect(selectWindow({ hourly, daily }, "all")!.points).toHaveLength(40)
    expect(selectWindow({ hourly, daily }, "30d")!.rate).toBe(0.9)
  })
  it("retains null when the window has no ceremonies", () => {
    expect(selectWindow({ hourly: [], daily: [point(first, 0, 0)] }, "all")!.rate).toBeNull()
    expect(selectWindow({ hourly: [], daily: [] }, "all")).toBeUndefined()
  })
  it("names the actual programmes and UTC date range", () => {
    const window = selectWindow({ hourly: [], daily: [{ ...point(betaEnd), programme: "beta" }, point(first)] }, "all")!
    expect(window.programmes).toEqual(["beta", "aegis"])
    expect(windowLabel(window, i18n.t)).toContain("Beta / Aegis, 5 Oct 2026 to")
  })
})
