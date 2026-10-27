import { useTranslation } from "react-i18next"
import { lazy, Suspense, type ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import type { TimeSeriesChartProps } from "./TimeSeriesChart"

const TimeSeriesChart = lazy(() => import("./TimeSeriesChart"))

interface ChartFigureProps {
  /** One sentence that says what the chart shows, read in place of the plot. */
  summary: string
  chart: TimeSeriesChartProps
  /** The same figures as a table: the text alternative, and the only way to read every value. */
  table: { columns: readonly string[]; rows: readonly (readonly ReactNode[])[] }
}

/**
 * A chart with its text alternatives: the summary as the plot's label, a legend when there is
 * more than one series, so no series is told apart by colour alone, and a table of every value.
 */
export function ChartFigure({ summary, chart, table }: ChartFigureProps) {
  const { t } = useTranslation()
  return (
    <figure className="min-w-0 space-y-3">
      {chart.series.length > 1 && (
        <ul aria-label={t("selector.legend", "Legend")} className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {chart.series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div role="img" aria-label={summary} className="h-64">
        <div aria-hidden="true" className="h-full">
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TimeSeriesChart {...chart} />
          </Suspense>
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("selector.showTable", "Show the figures as a table")}</summary>
        {/* The table scrolls inside its box, so the box takes focus for keyboard scrolling. */}
        <div className="relative mt-2 max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={t("selector.tableLabel", "Table: {{summary}}", { summary })}>
          <table className="w-full text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-faint">
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={`whitespace-nowrap py-2 font-normal ${i === 0 ? "pr-3 text-left" : "px-3 text-right"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} className="border-b border-border last:border-0">
                  {row.map((cell, i) => (
                    <td key={i} className={`whitespace-nowrap py-1.5 font-mono tabular-nums ${i === 0 ? "pr-3 text-left" : "px-3 text-right"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
