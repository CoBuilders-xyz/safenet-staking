import { describe, expect, it } from "vitest"
import { dailySeries, lastCompleteDay, rangeWindow } from "../history"

const day = 86400

describe("daily history", () => {
  it("carries stake forward across quiet days and orders observations", () => {
    expect(dailySeries([{ date: 3 * day, value: 8 }, { date: day, value: 5 }], true, 4 * day)).toEqual([
      { date: day, value: 5 }, { date: 2 * day, value: 5 }, { date: 3 * day, value: 8 }, { date: 4 * day, value: 8 },
    ])
  })
  it("fills quiet attestation days with zero without inventing earlier history", () => {
    expect(dailySeries([{ date: 2 * day, value: 4 }], false, 3 * day)).toEqual([
      { date: 2 * day, value: 4 }, { date: 3 * day, value: 0 },
    ])
    expect(dailySeries([], false, day)).toEqual([])
  })
})

 it("includes covered zero days before the first attestation", () => {
  expect(dailySeries([{ date: 3 * day, value: 4 }], false, 3 * day, day)).toEqual([
    { date: day, value: 0 }, { date: 2 * day, value: 0 }, { date: 3 * day, value: 4 },
  ])
  expect(dailySeries([], false, 2 * day, day)).toHaveLength(2)
 })
 it("does not count a day until the index has reached its end", () => {
  expect(lastCompleteDay(3 * day * 1000, 3 * day - 1)).toBe(day)
  expect(lastCompleteDay(3 * day * 1000, 3 * day)).toBe(2 * day)
 })

describe("range window", () => {
  const history = (days: number, end: number) => Array.from({ length: days }, (_, i) => ({ date: end - (days - 1 - i) * day, value: i }))
  const end = 100 * day

  it("shows exactly the last 30 days of a longer history, and all of it for all time", () => {
    const series = history(43, end)
    const thirty = rangeWindow(series, 30, end)
    expect(thirty.visible).toHaveLength(30)
    expect(thirty.visible[0].date).toBe(end - 29 * day)
    expect(thirty.visible.at(-1)!.date).toBe(end)
    expect(thirty.whole).toBe(false)
    expect(rangeWindow(series, 7, end).visible).toHaveLength(7)
    expect(rangeWindow(series, "all", end)).toEqual({ visible: series, whole: false })
  })
  it("says when a range is longer than the history, where it matches all time", () => {
    // The Aegis history on 6 November 2026: 29 complete days, from 8 October to 5 November.
    const series = history(29, end)
    expect(rangeWindow(series, 30, end)).toEqual({ visible: series, whole: true })
    expect(rangeWindow(series, 7, end).whole).toBe(false)
    expect(rangeWindow(history(30, end), 30, end).whole).toBe(false)
    expect(rangeWindow([], 30, end)).toEqual({ visible: [], whole: false })
  })
})
