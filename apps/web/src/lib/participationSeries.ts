import type { TFunction } from "i18next"
import { GNOSIS_AEGIS_FIRST_COMPLETE_DAY, utcDayMs, programmePhase, type Programme } from "@cobuilders/safenet-core"
import type { ValidatorParticipationQuery } from "@/graphql/gnosis/generated"
import { shortDay } from "./utcDates"

const HOUR = 3_600
const DAY = 86_400

/** graph-node caps `first` at 1000. A page shorter than this holds every row there is. */
const PAGE_LIMIT = 1000

export const PROGRAMME_LABEL: Record<Programme, string> = { beta: "Beta", aegis: "Aegis" }

/**
 * The programme a Gnosis bucket belongs to. A deployment that indexes more than one programme
 * names it in the row's `programme` field and starts the row's id with it. A deployment that
 * indexes Beta alone has neither, so a legacy row without them is Beta. Current queries select
 * the explicit programme; the prefix remains useful when interpreting older fixtures.
 */
export function bucketProgramme(row: { id: string; programme?: string | null }): Programme {
  const named = row.programme ?? row.id.split("-")[0]
  return named === "aegis" ? "aegis" : "beta"
}

export type Span = "hour" | "day"

export interface ParticipationPoint {
  programme: Programme
  /** Unix seconds of the bucket's start. */
  start: number
  attended: number
  /** The network's attestation ceremonies in the bucket: SEF's denominator. */
  ceremonies: number
  /** attended / ceremonies; null when no ceremony occurred. */
  rate: number | null
}

interface Bucket {
  id: string
  programme?: string | null
  start: number
  count: number
}

/**
 * Complete buckets for verified programme members. Aegis starts at core's verified coverage
 * boundary, including silent days. Beta drops its first stored bucket. No ceremonies means
 * an undefined rate, not 0% attendance. Missing validator rows mean zero only for known members.
 */
export function buildSeries(network: readonly Bucket[], validator: readonly Bucket[], span: Span, nowSeconds: number, members: readonly Programme[] = []): ParticipationPoint[] {
  const length = span === "hour" ? HOUR : DAY
  const result: ParticipationPoint[] = []
  for (const programme of members) {
    const rows = network.filter((b) => bucketProgramme(b) === programme)
    if (!rows.length) continue
    const first = programme === "aegis"
      ? utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000
      : Math.min(...rows.map((b) => b.start)) + length
    const complete = rows.filter((b) => b.start >= first && b.start + length <= nowSeconds)
      .filter((b) => programme !== "beta" || programmePhase(new Date(b.start * 1000)) === "beta")
    if (!complete.length) continue
    const last = Math.max(...complete.map((b) => b.start))
    const ceremonies = new Map(complete.map((b) => [b.start, b.count]))
    const attended = new Map(validator.filter((b) => bucketProgramme(b) === programme).map((b) => [b.start, b.count]))
    for (let start = first; start <= last; start += length) {
      const n = ceremonies.get(start) ?? 0
      const a = attended.get(start) ?? 0
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(a) || a < 0 || n < a) throw new Error("Invalid participation counts")
      result.push({ programme, start, attended: a, ceremonies: n, rate: n === 0 ? null : a / n })
    }
  }
  return result.sort((a, b) => a.start - b.start)
}

export interface ValidatorSeries {
  hourly: ParticipationPoint[]
  daily: ParticipationPoint[]
}

/** Both series from one ValidatorParticipation answer. */
export function seriesFromAnswer(data: ValidatorParticipationQuery, nowSeconds: number, address: string): ValidatorSeries {
  const memberships = data.memberships
  if (memberships.length >= 3 || memberships.some((m) => m.validators.length >= PAGE_LIMIT || m.validators.length !== m.validatorCount)) {
    throw new Error("Incomplete programme membership")
  }
  if ((data.consensusDays.length || data.consensusHours.length) && !memberships.length) throw new Error("Missing programme membership")
  const members = memberships.filter((m) => m.validators.some((v) => v.id.toLowerCase() === address.toLowerCase()))
    .map((m) => m.programme).filter((p): p is Programme => p === "beta" || p === "aegis")
  return {
    hourly: buildSeries(
      data.consensusHours.map((h) => ({ id: h.id, programme: h.programme, start: h.hour, count: h.attestationCeremonies })),
      data.validatorHours.map((h) => ({ id: h.id, programme: h.programme, start: h.hour, count: h.attended })),
      "hour",
      nowSeconds,
      members,
    ),
    daily: buildSeries(
      data.consensusDays.map((d) => ({ id: d.id, programme: d.programme, start: d.date, count: Number(d.attestationCeremonies) })),
      data.validatorDays.map((d) => ({ id: d.id, programme: d.programme, start: d.date, count: Number(d.attended) })),
      "day",
      nowSeconds,
      members,
    ),
  }
}

export type WindowKey = "7d" | "30d" | "all"

export const windowOptions = (t: TFunction): readonly { key: WindowKey; label: string }[] => [
  { key: "7d", label: t("selector.sevenDays", "7 days") },
  { key: "30d", label: t("selector.thirtyDays", "30 days") },
  { key: "all", label: t("selector.all", "All") },
]

export interface ParticipationWindow {
  key: WindowKey
  span: Span
  points: ParticipationPoint[]
  /** Unix seconds of the first and last bucket's start. */
  from: number
  to: number
  /** The programmes the window holds, in calendar order. */
  programmes: Programme[]
  attended: number
  ceremonies: number
  /** Over the whole window: attended over ceremonies. */
  rate: number | null
}

/**
 * A window ending at the newest complete bucket the subgraph holds, not at today: a programme that
 * has ended keeps its last figures, dated, instead of an empty chart. 7 days reads the hourly
 * buckets; 30 days and all read the daily ones. Undefined when the window holds no bucket.
 */
export function selectWindow(series: ValidatorSeries, key: WindowKey): ParticipationWindow | undefined {
  const source = key === "7d" ? series.hourly : series.daily
  if (source.length === 0) return undefined
  const last = source[source.length - 1].start
  const days = key === "7d" ? 7 : key === "30d" ? 30 : Infinity
  const points = source.filter((p) => p.start > last - days * DAY)
  const attended = points.reduce((sum, p) => sum + p.attended, 0)
  const ceremonies = points.reduce((sum, p) => sum + p.ceremonies, 0)
  const order: Programme[] = ["beta", "aegis"]
  return {
    key,
    span: key === "7d" ? "hour" : "day",
    points,
    from: points[0].start,
    to: last,
    programmes: order.filter((p) => points.some((x) => x.programme === p)),
    attended,
    ceremonies,
    rate: ceremonies === 0 ? null : attended / ceremonies,
  }
}

/** "Beta, 22 Sep 2026 to 5 Oct 2026": the programmes and the days a window covers. */
export function windowLabel(w: ParticipationWindow, t: TFunction): string {
  const names = w.programmes.map((p) => PROGRAMME_LABEL[p]).join(" / ")
  return t("selector.windowLabel", "{{programmes}}, {{from}} to {{to}}", { programmes: names, from: shortDay(w.from), to: shortDay(w.to) })
}
