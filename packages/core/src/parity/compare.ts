/**
 * The comparison behind `pnpm test:parity`: our subgraphs against SEF's published files.
 *
 * Pure functions, no I/O, so the rules are tested without a network. The subgraph packages
 * fetch the inputs through ./sources.ts and hand them here.
 */
import { SEF_DATA } from "../contracts.js"
import { BETA_END_DAY, utcDayMs, type Programme, type SefValidator, type UtcDay } from "../sef.js"

/**
 * One row's verdict. NOT COMPARABLE: our deployment cannot answer at SEF's instant, SEF's
 * window lies after the programme our deployment indexes, or SEF publishes no value for the
 * figure; a known limit, not a disagreement. NOT COMPARED: a figure SEF publishes that we do not
 * hold.
 */
export type Verdict = "PASS" | "FAIL" | "NOT COMPARABLE" | "NOT COMPARED"

/**
 * The result of one chain's run, and the only states it can end in.
 *
 *   PASS            every compared figure is identical to SEF's                    exit 0
 *   FAIL            a figure differs, the subgraph is broken or behind, SEF's
 *                   data is over 24 hours old, or the run hit an error            exit 1
 *   STALE           SEF's file is over 9 hours old, so nothing is compared         exit 0
 *   NOT COMPARABLE  our deployment cannot answer at SEF's instant, SEF's window
 *                   lies after the programme it indexes, or SEF publishes no
 *                   value for a figure                                            exit 0
 *
 * Only FAIL exits 1, so the daily job turns red only on something someone can act on.
 */
export type ParityState = "PASS" | "FAIL" | "STALE" | "NOT COMPARABLE"

export const EXIT_CODE: Readonly<Record<ParityState, 0 | 1>> = {
  "PASS": 0,
  "FAIL": 1,
  "STALE": 0,
  "NOT COMPARABLE": 0,
}

/**
 * Why a Gnosis deployment without hourly buckets is not compared: SEF's window is a sum of the
 * rows filed by the hour each ceremony was attested in, and an older schema has none.
 */
export const NEEDS_HOURLY_BUCKETS = "hourly buckets with completion semantics are needed to compare this window"

/** Why a validator SEF lists with a null `participation_rate_14d` is not compared. */
export const SEF_PUBLISHES_NO_RATE = "SEF publishes no rate"

/**
 * How a figure is compared. SEF's participation rates are doubles and its staked total is
 * written to the wei, so both are compared exactly. A figure SEF rounds declares the decimal
 * places it rounds to, and is compared at that precision.
 */
export type Precision = "exact" | { decimals: number }

export interface ParityRow {
  figure: string
  ours: string
  sef: string
  /** "exact", or the decimal places SEF rounds to. Printed, so the output says which. */
  precision: string
  verdict: Verdict
  note?: string
}

export function describePrecision(p: Precision): string {
  return p === "exact" ? "exact" : `${p.decimals} decimals`
}

/**
 * Whether two numbers agree at a precision. Rounded to `decimals` places, a value lies within
 * half a unit in the last place of the true one, whichever way SEF rounds half.
 */
export function agrees(ours: number, sef: number, p: Precision): boolean {
  if (!Number.isFinite(ours) || !Number.isFinite(sef)) return false
  if (p === "exact") return ours === sef
  // The factor absorbs the binary representation error of 10^-decimals itself.
  return Math.abs(ours - sef) <= 0.5 * 10 ** -p.decimals * (1 + 1e-9)
}

/**
 * Participation per validator over SEF's window.
 *
 * `attended` holds, per lower-case signing address, the winning attestation ceremonies the
 * validator shared in inside the window; `ceremonies` holds the attestation ceremonies in it.
 * The rate is the same division SEF performs, so on an aligned window it is the same double.
 *
 * Every validator SEF lists gets a row. A signer with attendance in the window that SEF does
 * not list also gets one, and fails: the two sets must be the same.
 *
 * A validator SEF lists with a null rate is NOT COMPARABLE: there is no figure to agree or
 * disagree with. A window with no ceremonies fails only when SEF publishes some rate for it.
 */
export function compareParticipation(input: {
  sef: readonly SefValidator[]
  attended: ReadonlyMap<string, bigint>
  ceremonies: bigint
  precision?: Precision
}): ParityRow[] {
  const precision = input.precision ?? "exact"
  const shown = describePrecision(precision)
  if (input.ceremonies <= 0n && input.sef.some((v) => v.participation_rate_14d !== null)) {
    return [{
      figure: "attestation ceremonies in the window", ours: input.ceremonies.toString(), sef: "",
      precision: shown, verdict: "FAIL",
      note: "the subgraph counts none, so no rate can be compared",
    }]
  }
  const listed = new Set(input.sef.map((v) => v.address.toLowerCase()))
  const rows: ParityRow[] = input.sef.map((v) => {
    const figure = `${v.label} participation_rate_14d`
    if (v.participation_rate_14d === null) return notComparable(figure, SEF_PUBLISHES_NO_RATE)
    const n = input.attended.get(v.address.toLowerCase()) ?? 0n
    const ours = Number(n) / Number(input.ceremonies)
    return {
      figure,
      ours: String(ours),
      sef: String(v.participation_rate_14d),
      precision: shown,
      verdict: agrees(ours, v.participation_rate_14d, precision) ? "PASS" : "FAIL",
      note: `${n} / ${input.ceremonies}`,
    }
  })
  for (const [address, n] of input.attended) {
    if (n > 0n && !listed.has(address)) {
      rows.push({
        figure: `${address} participation`, ours: String(Number(n) / Number(input.ceremonies)), sef: "",
        precision: shown, verdict: "FAIL",
        note: `signed ${n} ceremonies in the window and is not in SEF's list`,
      })
    }
  }
  return rows
}

/** An integer figure SEF writes exactly, such as the staked total in wei. */
export function compareAmount(figure: string, ours: bigint, sef: bigint, note?: string): ParityRow {
  const row: ParityRow = {
    figure, ours: ours.toString(), sef: sef.toString(), precision: "exact",
    verdict: ours === sef ? "PASS" : "FAIL",
  }
  const why = note ?? (ours === sef ? undefined : `differs by ${ours - sef}`)
  if (why !== undefined) row.note = why
  return row
}

/** A change to the staked total: a stake adds its amount, an initiated withdrawal removes it. */
export interface Movement {
  block: bigint
  delta: bigint
}

/**
 * The staked total at each block from `from` to `to` where it could change, rewound from a
 * total known at block `at` (`at` >= `to`) through every movement after `from`.
 *
 * Exact: the total is the running sum of these movements, and a subgraph that stores each event
 * can give them all. It needs no history of the total itself, which a pruned deployment lacks.
 * The first entry is the total at `from`; then one per block in (`from`, `to`] that moved it.
 */
export function totalsBetween(input: {
  at: bigint
  total: bigint
  movements: readonly Movement[]
  from: bigint
  to: bigint
}): { block: bigint; total: bigint }[] {
  const { at, from, to } = input
  if (from > to || to > at) throw new Error(`expected from <= to <= at, got ${from}, ${to}, ${at}`)
  for (const m of input.movements) {
    if (m.block <= from) throw new Error(`movement at block ${m.block} is not after ${from}`)
  }
  const after = (b: bigint) => input.movements.reduce((sum, m) => (m.block > b ? sum + m.delta : sum), 0n)
  const blocks = [...new Set(input.movements.map((m) => m.block).filter((b) => b <= to))].sort((x, y) => (x < y ? -1 : 1))
  return [from, ...blocks].map((block) => ({ block, total: input.total - after(block) }))
}

/**
 * SEF's staked total against ours over SEF's run span.
 *
 * Compared first at `commitBlock`, the last block before SEF's commit. SEF's job indexes before
 * it commits, so its figure can also be the total at an earlier block in the span. It passes
 * there only if it equals that total to the wei; a real disagreement cannot land on one.
 */
export function compareStakedTotal(
  sef: bigint,
  totals: readonly { block: bigint; total: bigint }[],
  commitBlock: bigint,
): ParityRow {
  const figure = "total_staked_amount, wei"
  const atCommit = [...totals].reverse().find((t) => t.block <= commitBlock)
  if (!atCommit) throw new Error(`no total at or before block ${commitBlock}`)
  if (atCommit.total === sef) {
    return compareAmount(figure, atCommit.total, sef, `at block ${commitBlock}, SEF's commit`)
  }
  const earlier = totals.find((t) => t.total === sef)
  if (earlier) {
    const moved = totals.find((t) => t.block > earlier.block)
    return compareAmount(figure, earlier.total, sef,
      `at block ${earlier.block}: SEF read the chain before the movement at block ${moved?.block ?? commitBlock}, ` +
      `then committed at block ${commitBlock}`)
  }
  return compareAmount(figure, atCommit.total, sef,
    `at block ${commitBlock}, SEF's commit, ours differs by ${atCommit.total - sef}; ` +
    `no block from ${totals[0]!.block} on holds SEF's figure`)
}

/**
 * The overall result. Any failure fails. So does a run where nothing was compared: a table of
 * NOT COMPARED rows proves nothing, and must not show as a pass.
 */
export function overall(rows: readonly ParityRow[]): Exclude<ParityState, "STALE"> {
  if (rows.some((r) => r.verdict === "FAIL")) return "FAIL"
  if (rows.some((r) => r.verdict === "NOT COMPARABLE")) return "NOT COMPARABLE"
  return rows.some((r) => r.verdict === "PASS") ? "PASS" : "FAIL"
}

/**
 * Whether a subgraph error says the schema has no `consensusHours` field: a Gnosis deployment
 * built before the hourly buckets. graph-node words it "Type `Query` has no field `X`".
 */
export function lacksHourlyBuckets(message: string): boolean {
  return /has no field `consensusHours`/.test(message)
}

/** Why a Gnosis deployment without a `programme` on its rows is not compared. */
export const NEEDS_PROGRAMMES = "rows filed under their programme are needed to sum one programme's window"

/**
 * Whether a subgraph error says a `programme` filter is not in the schema: a Gnosis deployment
 * built before it indexed two programmes. Its rows mix nothing, but nothing says which programme
 * they are, so they are not summed. graph-node words it "Invalid value provided for argument
 * `where`" and quotes the filter, as version edc2588 answered on 2026-10-27.
 */
export function lacksProgrammes(message: string): boolean {
  return /Invalid value provided for argument `where`: .*"programme"/.test(message)
}

/** One ConsensusHour row, as the Gnosis subgraph returns it. See its schema. */
export interface ConsensusHourRow {
  hour: number
  attestationCeremonies: number
  attestationCeremoniesOnTheHour: number
}

/** One ValidatorHour row, as the Gnosis subgraph returns it, with the validator's id. */
export interface ValidatorHourRow {
  validator: string
  hour: number
  attended: number
  attendedOnTheHour: number
}

const HOUR_SECONDS = 3600

/**
 * SEF's numerator and denominator over its window, from the Gnosis subgraph's hourly rows.
 *
 * The window runs from `start` to `end`, both on the hour and both included, by the timestamp
 * of the block each ceremony was attested in. A row for hour H counts the blocks from H up to,
 * not including, H + 1 hour, and its `OnTheHour` fields count the block exactly at H. So the
 * window is every row from `start` to the hour before `end`, plus the `OnTheHour` fields of
 * the row at `end`. Rows outside the window are ignored; an hour with no row counted nothing.
 */
export function participationFromHours(input: {
  window: { start: Date; end: Date }
  consensus: readonly ConsensusHourRow[]
  validators: readonly ValidatorHourRow[]
}): { ceremonies: bigint; attended: Map<string, bigint> } {
  const start = input.window.start.getTime() / 1000
  const end = input.window.end.getTime() / 1000
  for (const [name, t] of [["start", start], ["end", end]] as const) {
    if (!Number.isInteger(t) || t % HOUR_SECONDS !== 0) {
      throw new Error(`the window ${name} is not on the hour: ${new Date(t * 1000).toISOString()}`)
    }
  }
  if (end <= start) throw new Error("the window ends before it starts")
  const share = (hour: number, whole: number, onTheHour: number): number => {
    if (!Number.isInteger(hour) || hour % HOUR_SECONDS !== 0) throw new Error(`a row's hour is not on the hour: ${hour}`)
    if (hour >= start && hour < end) return whole
    return hour === end ? onTheHour : 0
  }
  let ceremonies = 0n
  for (const r of input.consensus) {
    ceremonies += BigInt(share(r.hour, r.attestationCeremonies, r.attestationCeremoniesOnTheHour))
  }
  const attended = new Map<string, bigint>()
  for (const r of input.validators) {
    const id = r.validator.toLowerCase()
    attended.set(id, (attended.get(id) ?? 0n) + BigInt(share(r.hour, r.attended, r.attendedOnTheHour)))
  }
  return { ceremonies, attended }
}

// ------------------------------------------------------------------ the programme calendar

const PROGRAMME_NAME: Readonly<Record<Programme, string>> = { beta: "Beta", aegis: "Aegis" }

/**
 * The last UTC day of each programme, from the calendar in ../sef.ts. Undefined while it runs.
 * Not PROGRAMME_CLOSED_FROM: that closes Beta on AEGIS_START_DAY so verify:abis keeps the stray
 * ceremony of 6 October, but SEF publishes Aegis rates from 22 October, whose windows start
 * 8 October on. Comparing those with Beta counts would fail every validator for no real difference.
 */
const PROGRAMME_LAST_DAY: Readonly<Record<Programme, UtcDay | undefined>> = { beta: BETA_END_DAY, aegis: undefined }

const DAY_MS = 86_400_000

/**
 * Why SEF's participation window cannot be compared with a deployment that indexes the
 * programme `indexed`, or undefined when it can.
 *
 * SEF computes its rates over the programme running when it publishes. A window that starts
 * after the last day of the programme the deployment indexes holds no ceremony the deployment
 * counts, so every validator would FAIL with no real difference behind it. A window that still
 * holds an hour of that programme is compared as before. The caller keeps every FAIL from
 * another cause, which still wins over this.
 *
 * Aegis has no last day, so with GNOSIS_INDEXED_PROGRAMME on Aegis this returns undefined and the
 * rule does not apply.
 */
export function windowOutsideProgramme(window: { start: Date }, indexed: Programme): string | undefined {
  const lastDay = PROGRAMME_LAST_DAY[indexed]
  if (lastDay === undefined || window.start.getTime() < utcDayMs(lastDay) + DAY_MS) return undefined
  const name = PROGRAMME_NAME[indexed]
  return `SEF's window holds no day of ${name}, the programme this deployment indexes; ${name} ended on ${lastDay}`
}

/** A row that says why a figure cannot be compared today. Never a pass, never a failure. */
export function notComparable(figure: string, reason: string): ParityRow {
  return { figure, ours: "", sef: "", precision: "", verdict: "NOT COMPARABLE", note: reason }
}

// ---------------------------------------------------------------------------- the instant

export interface SefCommit {
  sha: string
  /** When SEF published the file. The instant every figure in it is compared at. */
  publishedAt: Date
}

/**
 * The last commit that wrote a file, from the GitHub commits API with `path=` and
 * `per_page=1`.
 *
 * The committer date, not the author date: SEF's job rebases before it pushes, which moves the
 * committer date to just before the push. Either way it falls after SEF's cron read the chain,
 * so it is an upper bound on the block SEF's figures describe. metrics-poc.ts aligns to the
 * same field and reproduces SEF's rates bit for bit.
 */
export function parseLastCommit(payload: unknown): SefCommit {
  if (!Array.isArray(payload)) {
    // A rate limit or a bad token answers with an object that carries a message. Say it, and
    // say what fixes it.
    const message = (payload as { message?: unknown } | null)?.message
    const said = typeof message === "string" ? `: ${message}` : ""
    const remedy = /rate limit/i.test(said)
      ? "unauthenticated requests are limited to 60 an hour; set GITHUB_TOKEN, or sign in to gh so `gh auth token` answers"
      : "check GITHUB_TOKEN, or `gh auth token` when it is unset"
    throw new Error(`the GitHub commits API did not return a list${said}; ${remedy}`)
  }
  const c = payload[0] as { sha?: unknown; commit?: { committer?: { date?: unknown } } } | undefined
  if (!c) throw new Error("the GitHub commits API returned no commit for the file")
  if (typeof c.sha !== "string" || !/^[0-9a-f]{40}$/.test(c.sha)) {
    throw new Error(`unexpected commit sha: ${JSON.stringify(c.sha)}`)
  }
  const date = c.commit?.committer?.date
  const publishedAt = typeof date === "string" ? new Date(date) : new Date(NaN)
  if (Number.isNaN(publishedAt.getTime())) throw new Error(`unexpected commit date: ${JSON.stringify(date)}`)
  return { sha: c.sha, publishedAt }
}

/**
 * The span SEF's cron read the chain in. The schedule starts it at or after the top of an hour,
 * and it indexes before it commits, so the figures it wrote describe a block between the top of
 * the hour the commit falls in and the commit itself. The participation window ends at the same
 * top of the hour; see participationWindow in ../sef.ts.
 */
export function sefRunSpan(publishedAt: Date): { from: Date; to: Date } {
  const hour = 3_600_000
  return { from: new Date(Math.floor(publishedAt.getTime() / hour) * hour), to: publishedAt }
}

// ----------------------------------------------------------------------------- freshness

export type Freshness = "fresh" | "stale" | "expired"

/**
 * SEF's cron writes every three hours. Past `staleAfterMs` its figures are too old to compare:
 * the result is STALE, which is neither a pass nor a failure. Past `expiredAfterMs` SEF's
 * pipeline has stopped, and the run fails so that someone looks.
 */
export function freshness(publishedAt: Date, now: Date): { state: Freshness; ageMs: number } {
  const ageMs = now.getTime() - publishedAt.getTime()
  if (ageMs > SEF_DATA.expiredAfterMs) return { state: "expired", ageMs }
  if (ageMs > SEF_DATA.staleAfterMs) return { state: "stale", ageMs }
  return { state: "fresh", ageMs }
}

/**
 * The state and the one line a run reports when SEF's file is not fresh, or undefined when it
 * is. `file` names the file in the line.
 */
export function staleOutcome(
  f: { state: Freshness; ageMs: number }, file: string,
): { state: "STALE" | "FAIL"; line: string } | undefined {
  if (f.state === "fresh") return undefined
  if (f.state === "expired") {
    return {
      state: "FAIL",
      line: `FAIL: SEF's data is stale. ${file} was last written ${formatAge(f.ageMs)} ago, more than ` +
        `${SEF_DATA.expiredAfterMs / 3_600_000} h: SEF's update job has stopped.`,
    }
  }
  return {
    state: "STALE",
    line: `STALE: ${file} was last written ${formatAge(f.ageMs)} ago, more than ` +
      `${SEF_DATA.staleAfterMs / 3_600_000} h. Not compared, and not a failure.`,
  }
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000)
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// ----------------------------------------------------------------------------- rendering

const COLUMNS = ["figure", "ours", "sef", "precision", "verdict", "note"] as const
const HEADINGS = ["FIGURE", "OURS", "SEF", "PRECISION", "RESULT", "NOTE"]

/** The table for a terminal. Every value is printed in full: formatting never alters one. */
export function renderText(rows: readonly ParityRow[]): string {
  const cells = rows.map((r) => COLUMNS.map((c) => r[c] ?? ""))
  const widths = HEADINGS.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i]!.length)))
  const line = (row: readonly string[]) => "  " + row.map((v, i) => v.padEnd(widths[i]!)).join("  ").trimEnd()
  return [line(HEADINGS), ...cells.map(line)].join("\n")
}

/** The same table as GitHub-flavoured Markdown, for the job summary. */
export function renderMarkdown(rows: readonly ParityRow[]): string {
  const escape = (v: string) => v.replaceAll("|", "\\|")
  return [
    `| ${HEADINGS.join(" | ")} |`,
    `|${HEADINGS.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${COLUMNS.map((c) => escape(r[c] ?? "")).join(" | ")} |`),
  ].join("\n")
}
