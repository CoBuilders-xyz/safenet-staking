import { formatUnits, parseEther } from "viem"

/** Format a token amount for display, with comma delimiters. */
export function formatTokenAmount(amount: bigint, decimals = 18, maxDecimals = 4): string {
  const raw = formatTokenAmountRaw(amount, decimals, maxDecimals)
  const [whole, decimal] = raw.split(".")
  const delimited = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return decimal ? `${delimited}.${decimal}` : delimited
}

/** Format a token amount as a plain numeric string (no commas). */
export function formatTokenAmountRaw(amount: bigint, decimals = 18, maxDecimals = 4): string {
  const formatted = formatUnits(amount, decimals)
  const [whole, decimal] = formatted.split(".")
  if (!decimal || maxDecimals === 0) return whole
  return `${whole}.${decimal.slice(0, maxDecimals)}`
}

/** Safely narrow an unknown wagmi read result to bigint. */
export function asBigint(value: unknown, fallback: bigint = 0n): bigint {
  return typeof value === "bigint" ? value : fallback
}

/** Parse an ether-formatted string, returning 0n on invalid input. */
export function safeParseEther(amount: string): bigint {
  try {
    return amount ? parseEther(amount) : 0n
  } catch {
    return 0n
  }
}

/**
 * A participation rate for display: a percentage with two decimals.
 *
 * Rounded, like any figure, unless the validator missed a ceremony. Then the value is floored,
 * so a validator that missed 2 of 59,192 reads 99.99% and never 100.00%: only a validator with
 * no miss reads 100.00%. The rate is taken at nine decimals first, the precision the subgraph
 * ratio carries, because a bare floor drops a unit on many floats: 3 attended of 10,000 is the
 * rate 0.0003, and 0.0003 times 10,000 is a hair under 3, which would read 0.02% and not 0.03%.
 */
export function formatParticipation(rate: number, absences: bigint | undefined): string {
  if (absences === undefined || absences === 0n) return `${(rate * 100).toFixed(2)}%`
  const tenThousandths = Math.floor(Number((rate * 10_000).toFixed(5)))
  return `${(tenThousandths / 100).toFixed(2)}%`
}

export function truncateAddress(address: string): string {
  const lower = address.toLowerCase()
  return `${lower.slice(0, 6)}...${lower.slice(-4)}`
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ready"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Format a UTC day in words, e.g. "5 October 2026". */
export function formatUtcDayLong(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * Format an ISO timestamp in UTC, e.g. "Tue 22 Sep 2026, 00:00 UTC".
 * Built by hand rather than with Intl, whose month abbreviations vary by runtime.
 */
export function formatUtcDateTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`
}
