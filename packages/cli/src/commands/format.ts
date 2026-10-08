/**
 * Output formatting. Pure functions, so they are tested without a network.
 *
 * Formatting never alters a value: an amount is printed to the last wei it has, and rounding
 * happens only where the output says so (percentages, to two places).
 */
import { formatUnits } from "viem"
import type { ParticipationWindow, RewardsSourceUsed } from "../lib/index.js"

/**
 * What to do about a refused log scan. The library reports what failed; which flag to use is
 * the CLI's business, so this text lives here.
 */
export const ARCHIVE_ADVICE =
  "if the endpoint refused the range, historical log scans need an archive endpoint, which the " +
  "public endpoints are not, so set MAINNET_RPC_URL or pass --rpc-url; --verbose shows the error"

/** An 18-decimal amount in SAFE, exact, grouped in thousands, trailing zeros dropped. */
export function formatSafe(wei: bigint): string {
  const negative = wei < 0n
  const [whole = "0", frac] = formatUnits(negative ? -wei : wei, 18).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""} SAFE`
}

/**
 * A fraction as a percentage. 0.97650567 -> "97.65%". Participation uses three places, so a
 * rate of 99.997% does not print as 100.00%.
 */
export function formatPercent(fraction: number, places = 2): string {
  return `${(fraction * 100).toFixed(places)}%`
}

export function formatCount(n: number | bigint): string {
  return n.toLocaleString("en-US")
}

/** "2026-10-04 21:00 UTC". Minutes are enough for every time this tool shows. */
export function formatTime(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

/**
 * The sentence that goes next to every participation rate.
 * A rate without its window reads as a fact about all time; it is not.
 */
export function windowSentence(w: ParticipationWindow): string {
  if (w.start && w.end && w.publishedAt) {
    return (
      `${w.days}-day window, ${formatTime(w.start)} to ${formatTime(w.end)}: ` +
      `SEF published at ${formatTime(w.publishedAt)}` +
      `${w.commit ? ` (commit ${w.commit.slice(0, 7)})` : ""}, floored to the hour`
    )
  }
  return (
    `${w.days}-day window ending at SEF's last publish; its time is unknown because ` +
    `${w.unknownBecause ?? "the GitHub API did not answer"}`
  )
}

export type Align = "left" | "right"

export interface Column {
  readonly header: string
  readonly align?: Align
}

/** A plain-text table: two spaces between columns, headers in capitals as given. */
export function renderTable(columns: readonly Column[], rows: readonly (readonly string[])[]): string {
  const widths = columns.map((c, i) => Math.max(c.header.length, ...rows.map((r) => (r[i] ?? "").length)))
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) => {
        const w = widths[i] ?? 0
        return columns[i]?.align === "right" ? cell.padStart(w) : cell.padEnd(w)
      })
      .join("  ")
      .trimEnd()
  return [line(columns.map((c) => c.header)), ...rows.map(line)].join("\n")
}

/** Label and value pairs, labels aligned. For the one-item views. */
export function renderPairs(pairs: readonly (readonly [string, string])[]): string {
  const w = Math.max(...pairs.map(([k]) => k.length))
  return pairs.map(([k, v]) => `${k.padEnd(w)}  ${v}`.trimEnd()).join("\n")
}

/**
 * Machine output. Amounts are bigints in the library and become decimal strings in wei here,
 * because JSON numbers lose precision past 2^53. Dates become ISO 8601.
 */
export function toJson(data: unknown): string {
  return JSON.stringify(
    data,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )
}

/** Time from `from` to `to`, as "1d 4h" or "35m". Negative spans read "now". */
export function formatSpan(from: Date, to: Date): string {
  const minutes = Math.floor((to.getTime() - from.getTime()) / 60_000)
  if (minutes <= 0) return "now"
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Which source a reward file came from, and, when it is the mirror, why. A dataset that
 * answered 404 on every gateway is told apart from one that did not answer: the first points
 * at the dataset's layout, the second at the gateways.
 */
export function describeRewardsSource(r: RewardsSourceUsed): string {
  if (r.kind === "ens") return `SEF's IPFS dataset (ENS), through ${r.gateway ? new URL(r.gateway).host : "a gateway"}`
  if (r.kind === "override") return "a configured URL"
  const gateways = r.tried.filter((t) => t.kind === "ens")
  const why = {
    set: gateways.length > 0 && gateways.every((t) => t.outcome === "not found")
      ? "the IPFS dataset has no such file at the expected path"
      : "the IPFS dataset did not answer",
    empty: `${r.ens.name} has no contenthash yet`,
    unsupported: `${r.ens.name} is set in a form this tool cannot read`,
    unreadable: `${r.ens.name} could not be read`,
  }[r.ens.status]
  return `SEF's repository, a mirror: ${why}`
}
