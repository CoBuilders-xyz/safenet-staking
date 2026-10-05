/**
 * The comparison behind `pnpm test:parity`: our subgraphs against SEF's published files.
 *
 * Pure functions, no I/O, so the rules are tested without a network. The subgraph packages
 * fetch the inputs through ./sources.ts and hand them here.
 */
import { SEF_DATA } from "../contracts.js"
import type { SefValidator } from "../sef.js"

export type Verdict = "PASS" | "FAIL" | "NOT COMPARED"

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
 */
export function compareParticipation(input: {
  sef: readonly SefValidator[]
  attended: ReadonlyMap<string, bigint>
  ceremonies: bigint
  precision?: Precision
}): ParityRow[] {
  const precision = input.precision ?? "exact"
  const shown = describePrecision(precision)
  if (input.ceremonies <= 0n) {
    return [{
      figure: "attestation ceremonies in the window", ours: input.ceremonies.toString(), sef: "",
      precision: shown, verdict: "FAIL",
      note: "the subgraph counts none, so no rate can be compared",
    }]
  }
  const listed = new Set(input.sef.map((v) => v.address.toLowerCase()))
  const rows: ParityRow[] = input.sef.map((v) => {
    const n = input.attended.get(v.address.toLowerCase()) ?? 0n
    const ours = Number(n) / Number(input.ceremonies)
    return {
      figure: `${v.label} participation_rate_14d`,
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
export function overall(rows: readonly ParityRow[]): "PASS" | "FAIL" {
  if (rows.some((r) => r.verdict === "FAIL")) return "FAIL"
  return rows.some((r) => r.verdict === "PASS") ? "PASS" : "FAIL"
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
    // A rate limit or a bad token answers with an object that carries a message. Say it.
    const message = (payload as { message?: unknown } | null)?.message
    throw new Error(`the GitHub commits API did not return a list${typeof message === "string" ? `: ${message}` : ""}`)
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
