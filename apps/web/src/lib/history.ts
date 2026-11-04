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


/** Only a day before the indexed UTC day is complete. */
export function lastCompleteDay(checkedAt: number, indexedAt: number): number {
  return Math.floor(Math.min(checkedAt / 1000, indexedAt) / DAY) * DAY - DAY
}
