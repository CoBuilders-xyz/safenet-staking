const DAY = 86400
export type Point = { date: number; value: number }

/** Fill quiet days, starting at a verified coverage boundary when supplied. */
export function dailySeries(rows: Point[], carry: boolean, end: number, start?: number): Point[] {
  if (!rows.length && start === undefined) return []
  const sorted = [...rows].sort ( (a, b) => a.date - b.date)
  const byDay = new Map(sorted.map((row) => [row.date, row.value]))
  const result: Point[] = []
  let previous = 0
  for (let day = (start ?? sorted[0].date); day <= end; day += DAY) {
    previous = byDay.get(day) ?? (carry ? previous : 0)
    result.push({ date: day, value: previous })
  }
  return result
}

export type HistoryRange = number | "all"

/**
 * The days a range shows: the newest `range` days up to `end`, or every day for "all".
 * `whole` says a numbered range is longer than the history, so it shows all of it, as "all" does.
 */
export function rangeWindow(series: Point[], range: HistoryRange, end: number): { visible: Point[]; whole: boolean } {
  if (range === "all") return { visible: series, whole: false }
  const visible = series.filter((d) => d.date > end - range * DAY)
  return { visible, whole: series.length > 0 && series.length < range }
}

/** Only a day before the indexed UTC day is complete. */
export function lastCompleteDay(checkedAt: number, indexedAt: number): number {
  return Math.floor(Math.min(checkedAt / 1000, indexedAt) / DAY) * DAY - DAY
}
