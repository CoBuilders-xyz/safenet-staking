import { useTranslation } from "react-i18next"
import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { OverviewSection } from "@/components/overview/OverviewSection"
import { useValidatorParticipation } from "@/hooks/useValidatorParticipation"
import {
  PROGRAMME_LABEL,
  windowOptions,
  selectWindow,
  windowLabel,
  type ParticipationWindow,
  type WindowKey,
} from "@/lib/participationSeries"
import { formatParticipation } from "@/lib/format"
import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { dateTime, dayTick, shortDay } from "@/lib/utcDates"
import { ChartFigure } from "./ChartFigure"
import { ParticipationRate } from "./ParticipationRate"
import { Segmented } from "./Segmented"

/** Each programme keeps its series colour wherever it appears. */
const SERIES_COLOR = { beta: "var(--chart-2)", aegis: "var(--chart-1)" } as const

/** A rate beside a missed count is floored, so it never reads 100.00% above "2 missed". */
const percent = (attended: number, ceremonies: number) => ceremonies === 0 ? "—" : formatParticipation(attended / ceremonies, BigInt(ceremonies - attended))

/**
 * One validator's participation per hour over 7 days, and per day over 30 days and over
 * everything the Gnosis subgraph holds. Each window ends at the newest complete bucket, so while
 * the subgraph holds only Beta, which has ended, the chart shows Beta's last days, labelled Beta,
 * under the dated notice, and never as current figures. The page states SEF's reward rule once,
 * beside the published rate, and the chart marks its threshold.
 */
export function ParticipationHistory({ address }: { address: string }) {
  const { t } = useTranslation()
  const { series } = useValidatorParticipation(address)
  const [key, setKey] = useState<WindowKey>("30d")
  const window = series.state === "ready" ? selectWindow(series.value, key) : undefined
  const betaOnly = window !== undefined && window.programmes.every((p) => p === "beta")

  const source = window
    ? t("selector.historySource", "{{window}}. Gnosis subgraph: attended ceremonies divided by network ceremonies per complete UTC bucket.", { window: windowLabel(window, t) })
    : t("selector.historyBuckets", "Gnosis subgraph, hourly and daily buckets.")

  return (
    <OverviewSection title={t("selector.participationTitle", "Participation over time")} source={source}>
      <Segmented label={t("selector.window", "Window")} options={windowOptions(t)} value={key} onChange={setKey} />
      {series.state === "loading" ? (
        <Skeleton className="h-64 w-full" aria-label={t("overview.figure.loading", "Loading")} />
      ) : series.state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">{t("overview.boundary.unavailable", "Unavailable. {{reason}}", { reason: series.reason })}</p>
      ) : !window ? (
        <p className="text-sm text-muted-foreground">{t("selector.noParticipation", "No complete participation history is available for this validator and window.")}</p>
      ) : (
        <WindowChart window={window} betaOnly={betaOnly} />
      )}
    </OverviewSection>
  )
}

function WindowChart({ window, betaOnly }: { window: ParticipationWindow; betaOnly: boolean }) {
  const { t } = useTranslation()
  const hourly = window.span === "hour"
  const missed = window.ceremonies - window.attended
  const data = window.points.map((p) => ({ x: p.start, [p.programme]: p.rate === null ? null : p.rate * 100 }))
  const summary = t("selector.participationSummary", "{{window}}: {{rate}} attendance; {{missed}} of {{total}} ceremonies missed.", { window: windowLabel(window, t), rate: percent(window.attended, window.ceremonies), missed: missed.toLocaleString("en-US"), total: window.ceremonies.toLocaleString("en-US") })

  return (
    <div className="space-y-3">
      {betaOnly && (
        <p role="note" aria-label={t("programme.betaEndedLabel", "Beta ended")} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t("selector.historicalBeta", "Beta has ended. These are historical figures.")}
        </p>
      )}
      <p className="text-sm">
        {t("selector.overWindow", "Over this window:")} {window.rate === null ? "—" : <ParticipationRate className="font-mono" rate={window.rate} text={percent(window.attended, window.ceremonies)} />}
        <span className="text-muted-foreground">
          {" "}
          {t("selector.missedCount", "{{missed}} of {{total}} ceremonies missed", { missed: missed.toLocaleString("en-US"), total: window.ceremonies.toLocaleString("en-US") })}
        </span>
      </p>
      <ChartFigure
        summary={summary}
        chart={{
          data,
          series: window.programmes.map((p) => ({ key: p, label: PROGRAMME_LABEL[p], color: SERIES_COLOR[p] })),
          yDomain: [0, 100],
          formatY: (v) => `${Math.round(v * 100) / 100}%`,
          formatTick: dayTick,
          formatTooltipX: (x) => (hourly ? dateTime(x) : shortDay(x)),
          threshold: { y: REWARD_PARTICIPATION_THRESHOLD * 100, label: t("selector.threshold", "{{threshold}} reward threshold", { threshold: `${REWARD_PARTICIPATION_THRESHOLD * 100}%` }) },
        }}
        table={{
          columns: [hourly ? t("selector.hourUtc", "Hour (UTC)") : t("selector.dayUtc", "Day (UTC)"), t("selector.programme", "Programme"), t("selector.attended", "Attended"), t("selector.ceremonies", "Ceremonies"), t("selector.participation", "Participation")],
          rows: [...window.points].reverse().map((p) => [
            hourly ? dateTime(p.start) : shortDay(p.start),
            PROGRAMME_LABEL[p.programme],
            p.attended.toLocaleString("en-US"),
            p.ceremonies.toLocaleString("en-US"),
            percent(p.attended, p.ceremonies),
          ]),
        }}
      />
    </div>
  )
}
