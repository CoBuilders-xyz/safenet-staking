import type { Address } from "viem"
import { HHI_DEFINITION } from "@/lib/distribution"
import { truncateAddress } from "@/lib/format"

/**
 * Series tokens from index.css, in the order the palette check passes adjacency in both themes:
 * slate, the near-neutral, goes last so it never sits next to purple.
 */
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)"]

export interface DistributionRow {
  address: Address
  label: string | undefined
  /** Fraction of all stake. */
  share: number
}

/**
 * Colour follows the validator, not its rank: slots go by address order, so a change in stake
 * reorders the bar without repainting anyone. Validators past the sixth share the last slot.
 */
function colourByAddress(rows: readonly DistributionRow[]): Map<string, string> {
  const order = [...rows].map((r) => r.address.toLowerCase()).sort()
  return new Map(order.map((a, i) => [a, SERIES[Math.min(i, SERIES.length - 1)]]))
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`

/** Stake per validator as one stacked bar, each segment labelled in the list below. */
export function Distribution({ rows, index }: { rows: readonly DistributionRow[]; index: number }) {
  const colours = colourByAddress(rows)
  const name = (r: DistributionRow) => r.label ?? truncateAddress(r.address)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-2xl tabular-nums tracking-tight">HHI {index.toLocaleString("en-US")}</span>
        <span className="text-xs text-muted-foreground">{HHI_DEFINITION}</span>
      </div>

      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label="Stake share per validator">
        {rows
          .filter((r) => r.share > 0)
          .map((r) => (
            <div
              key={r.address}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${r.share * 100}%`, background: colours.get(r.address.toLowerCase()) }}
              title={`${name(r)} ${percent(r.share)}`}
            />
          ))}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.address} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: colours.get(r.address.toLowerCase()) }}
              aria-hidden="true"
            />
            <span className="truncate">{name(r)}</span>
            <span className="ml-auto font-mono tabular-nums text-muted-foreground">{percent(r.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
