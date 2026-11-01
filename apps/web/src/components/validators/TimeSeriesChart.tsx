import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { dayTicks } from "@/lib/utcDates"

export interface ChartSeries {
  /** The data key of this series' values. */
  key: string
  label: string
  /** A series token from index.css, so the colour follows light and dark mode. */
  color: string
}

export interface TimeSeriesChartProps {
  /** One row per x, in unix seconds as `x`, with a value or null per series key. */
  data: Record<string, number | null>[]
  series: readonly ChartSeries[]
  yDomain: [number, number | "auto"]
  formatY: (value: number) => string
  formatTick: (x: number) => string
  formatTooltipX: (x: number) => string
  /** A horizontal rule with its label, such as the reward threshold. */
  threshold?: { y: number; label: string }
  /** Draw steps that hold each value until the next point, for counts that change on events. */
  step?: boolean
}

/**
 * A line chart over time in the interface's tokens: hairline grid and axes in the rule and muted
 * colours, 2px lines, no animation. Loaded lazily, so Recharts stays out of the first bundle. The
 * caller gives the chart a text alternative; this component draws only the plot.
 */
export default function TimeSeriesChart({ data, series, yDomain, formatY, formatTick, formatTooltipX, threshold, step }: TimeSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* The caller labels the chart as an image and gives a table, so the plot takes no focus. */}
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="x"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={dayTicks(data.map((d) => d.x ?? 0))}
          tickFormatter={formatTick}
          stroke="var(--border)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          domain={yDomain}
          tickFormatter={formatY}
          stroke="var(--border)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        {threshold && (
          <ReferenceLine
            y={threshold.y}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: threshold.label, position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 12 }}
          />
        )}
        <Tooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div className="rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md">
                <p className="text-xs text-muted-foreground">{formatTooltipX(Number(label))}</p>
                {payload
                  .filter((p) => typeof p.value === "number")
                  .map((p) => {
                    const s = series.find((x) => x.key === p.dataKey)
                    return (
                      <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-sm font-mono tabular-nums">
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s?.color }} />
                        {series.length > 1 && <span className="font-sans text-muted-foreground">{s?.label}</span>}
                        {formatY(Number(p.value))}
                      </p>
                    )
                  })}
              </div>
            )
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            type={step ? "stepAfter" : "linear"}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
