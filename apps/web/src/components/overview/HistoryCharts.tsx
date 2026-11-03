import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { GNOSIS_INDEXED_PROGRAMME, GNOSIS_AEGIS_FIRST_COMPLETE_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { StakeHistoryDocument, type StakeHistoryQuery } from "@/graphql/mainnet/generated"
import { AttestationHistoryDocument, type AttestationHistoryQuery } from "@/graphql/gnosis/generated"
import { useSubgraphQuery, type SubgraphResult } from "@/hooks/useSubgraphQuery"
import { dailySeries, lastCompleteDay } from "@/lib/history"
import { describeDegradation } from "@/lib/subgraph"
import { formatUtcDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { OverviewSection } from "./OverviewSection"

const DAY = 86400
const date = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)
type Range = 7 | 30 | "all"
export function HistoryChart({ kind }: { kind: "stake" | "attestations" }) {
  return kind === "stake" ? <StakeHistoryChart /> : <AttestationHistoryChart />
}

function StakeHistoryChart() {
  const result = useSubgraphQuery("mainnet", "stake-history", StakeHistoryDocument)
  return <Chart kind="stake" result={result} />
}

function AttestationHistoryChart() {
  const result = useSubgraphQuery("gnosis", "attestation-history", AttestationHistoryDocument, () => ({ programme: GNOSIS_INDEXED_PROGRAMME }))
  return <Chart kind="attestations" result={result} />
}

/** Render one independently sourced history and its accessible data table. */
function Chart({ kind, result }: { kind: "stake" | "attestations"; result: SubgraphResult<StakeHistoryQuery | AttestationHistoryQuery> }) {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>(30)
  const title = kind === "stake" ? t("overview.charts.stake", "Total SAFE staked over time") : t("overview.charts.attestations", "Attestations per day")
  const source = kind === "stake" ? t("overview.charts.mainnet", "Mainnet subgraph") : t("overview.charts.gnosis", "Gnosis subgraph")
  const today = result.status === "live" ? Math.floor(result.freshness.checkedAt / 1000 / DAY) * DAY : 0
  const raw = result.status === "live" ? (kind === "stake" && "dayDatas" in result.data
    ? result.data.dayDatas.map((d) => ({ date: d.date, value: Number(BigInt(d.totalStaked)) / 1e18 }))
    : "consensusDays" in result.data ? result.data.consensusDays.filter((d) => GNOSIS_INDEXED_PROGRAMME !== "aegis" || d.date >= utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000).map((d) => ({ date: d.date, value: Number(d.attestations) })) : []) : []
  const end = kind === "stake" || result.status !== "live" ? today : lastCompleteDay(result.freshness.checkedAt, result.freshness.blockTimestamp!)
  const pageFull = result.status === "live" && ("dayDatas" in result.data ? result.data.dayDatas.length : result.data.consensusDays.length) >= 1000
  const coverageStart = kind === "attestations" && GNOSIS_INDEXED_PROGRAMME === "aegis" && !pageFull
    ? utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000 : undefined
  const series = dailySeries(raw.filter((d) => d.date <= end), kind === "stake", end, coverageStart)
  const visible = range === "all" ? series : series.filter((d) => d.date >= end - (range - 1) * DAY)
  const freshness = result.status === "live" ? t("overview.charts.freshness", "{{source}}. Indexed block {{block}} at {{time}}.", {
    source, block: result.freshness.block.toLocaleString("en-US"), time: formatUtcDateTime(new Date(result.freshness.blockTimestamp! * 1000).toISOString()),
  }) : source
  return <OverviewSection title={title} source={freshness}>
    <div className="flex gap-2" role="group" aria-label={t("overview.charts.range", "Time range")}>
      {([7, 30, "all"] as const).map((r) => <Button key={r} size="sm" variant={range === r ? "default" : "outline"} aria-pressed={range === r} onClick={() => setRange(r)}>{r === "all" ? t("overview.charts.all", "All time") : t("overview.charts.days", "{{count}} days", { count: r })}</Button>)}
    </div>
    {result.status === "loading" ? <Skeleton className="h-64 w-full" aria-label={t("overview.figure.loading", "Loading")} /> : result.status === "degraded" ? <p role="alert">{describeDegradation(result.degradation, t)}</p> : pageFull && range === "all" ? <p role="alert">{t("overview.charts.tooMany", "History exceeds the available page. The chart cannot show all data.")}</p> : visible.length === 0 ? <p>{t("overview.charts.empty", "No data is available for this range.")}</p> : <> <div className="h-64 w-full" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "stake" ? <AreaChart data={visible}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={date} minTickGap={30} /><YAxis width={70} tickFormatter={(v: number) => v.toLocaleString("en-US", { notation: "compact" })} /><Tooltip labelFormatter={(v) => date(Number(v))} /><Area type="stepAfter" dataKey="value" name="SAFE" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.25} /></AreaChart> : <BarChart data={visible}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={date} minTickGap={30} /><YAxis width={70} tickFormatter={(v: number) => v.toLocaleString("en-US", { notation: "compact" })} /><Tooltip labelFormatter={(v) => date(Number(v))} /><Bar dataKey="value" name={title} fill="var(--chart-1)" /></BarChart>}
      </ResponsiveContainer>
    </div>
    <table className="sr-only">
      <caption>{title}</caption>
      <thead><tr><th scope="col">{t("overview.charts.date", "Date (UTC)")}</th><th scope="col">{title}</th></tr></thead>
      <tbody>{visible.map((point) => <tr key={point.date}><th scope="row">{date(point.date)}</th><td>{point.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td></tr>)}</tbody>
    </table></>}
    {kind === "attestations" && <p className="text-xs text-muted-foreground">{t("overview.charts.programme", "Programme: {{programme}}. Complete UTC days only.", { programme: GNOSIS_INDEXED_PROGRAMME })}</p>}
  </OverviewSection>
}
