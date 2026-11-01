import { describe, it, expect } from "vitest"
import { dateTime, dayTick, dayTicks, longDay, shortDay } from "../utcDates"

const DAY = 86_400
const SEP_22 = 1_790_035_200 // 2026-09-22 00:00 UTC

describe("UTC dates", () => {
  it("formats a day short, as a tick, long, and with its time", () => {
    expect(shortDay(SEP_22 + 3_600)).toBe("22 Sep 2026")
    expect(dayTick(SEP_22)).toBe("22 Sep")
    expect(longDay(SEP_22)).toBe("22 September 2026")
    expect(dateTime(SEP_22 + 14 * 3_600)).toBe("Tue 22 Sep 2026, 14:00 UTC")
  })
})

describe("dayTicks", () => {
  it("spreads ticks evenly over the range, each on a UTC midnight", () => {
    const ticks = dayTicks([SEP_22 - 100 * DAY + 3_600, SEP_22])
    expect(ticks).toEqual([0, 1, 2, 3, 4].map((i) => SEP_22 - 99 * DAY + i * 20 * DAY))
    expect(ticks.every((t) => t % DAY === 0)).toBe(true)
  })

  it("never steps less than a day, and is empty with no data", () => {
    expect(dayTicks([SEP_22, SEP_22 + 3 * 3_600])).toEqual([SEP_22])
    expect(dayTicks([])).toEqual([])
  })
})
