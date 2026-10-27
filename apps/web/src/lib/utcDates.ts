import { formatUtcDateTime, formatUtcDayLong } from "./format"

/** "22 Sep 2026", from unix seconds. */
export function shortDay(unixSeconds: number): string {
  return formatUtcDateTime(new Date(unixSeconds * 1000).toISOString()).replace(/^\w+ /, "").replace(/, \d\d:\d\d UTC$/, "")
}

/** "22 Sep", from unix seconds: an axis tick. */
export function dayTick(unixSeconds: number): string {
  return shortDay(unixSeconds).replace(/ \d{4}$/, "")
}

/** "22 September 2026", from unix seconds. */
export function longDay(unixSeconds: number): string {
  return formatUtcDayLong(unixSeconds * 1000)
}

/** "Tue 22 Sep 2026, 14:00 UTC", from unix seconds. */
export function dateTime(unixSeconds: number): string {
  return formatUtcDateTime(new Date(unixSeconds * 1000).toISOString())
}

const DAY = 86_400

/** Up to `count` ticks spread evenly from the first x to the last, each on a UTC midnight. */
export function dayTicks(xs: readonly number[], count = 6): number[] {
  if (xs.length === 0) return []
  const first = Math.min(...xs)
  const last = Math.max(...xs)
  const step = Math.max(DAY, Math.ceil((last - first) / (count - 1) / DAY) * DAY)
  const ticks: number[] = []
  for (let t = Math.ceil(first / DAY) * DAY; t <= last; t += step) ticks.push(t)
  return ticks
}
