export interface PollRun { started_at: string; completed_at: string | null; ok: boolean }
const INTERVAL = 5 * 60_000
/** Missing slots count as downtime. Report Cron health, not a guarantee of device delivery. */
export function uptimeReport(runs: PollRun[], from: number, until: number) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || from % INTERVAL || until % INTERVAL) {
    throw new Error("Use an increasing UTC range aligned to five-minute boundaries")
  }
  const successful = new Set<number>()
  for (const run of runs) {
    const slot = Math.floor(Date.parse(run.started_at) / INTERVAL) * INTERVAL
    if (slot >= from && slot < until && run.ok && run.completed_at && Date.parse(run.completed_at) <= until) successful.add(slot)
  }
  const expected = (until - from) / INTERVAL
  return { from: new Date(from).toISOString(), until: new Date(until).toISOString(), expected,
    successful: successful.size, failedOrMissing: expected - successful.size, availabilityPercent: successful.size * 100 / expected }
}
