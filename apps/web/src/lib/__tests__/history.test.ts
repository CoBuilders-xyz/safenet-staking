import { describe, expect, it } from "vitest"
import { dailySeries, lastCompleteDay } from "../history"

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
