import { BETA_END_DAY, utcDayMs } from "../src/sef.js"

/** A fixed Beta window, independent of the date when SEF publishes Aegis data. */
export function betaWindow(days: number): { start: Date; end: Date } {
  if (!Number.isInteger(days) || days <= 0) throw new Error("Beta window days must be a positive integer")
  const end = utcDayMs(BETA_END_DAY) + 86_400_000
  return { start: new Date(end - days * 86_400_000), end: new Date(end) }
}
