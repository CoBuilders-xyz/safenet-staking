const DAY = 86400
export type Point = { date: number; value: number }

/** Fill quiet days only after the first known observation. */
export function dailySeries(rows: Point[], carry: boolean, end: number): Point[] {
  if (!rows.length) return []
  const sorted = [...rows].sort ( (a, b) => a.date - b.date)
  const byDay = new Map(sorted.map((row) => [row.date, row.value]))
  const result: Point[] = []
  let previous = 0
  for (let day = sorted[0].date; day <= end; day += DAY) {
    previous = byDay.get(day) ?? (carry ? previous : 0)
    result.push({ date: day, value: previous })
  }
  return result
}

