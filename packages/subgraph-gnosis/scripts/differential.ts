/**
 * Compare Beta participation with the independent chain scan in metrics-poc.ts.
 * Both readers use the oracle's explicit historical window. The subgraph sums hourly
 * buckets at one indexed block; its lifetime totals and today's SEF rates are not used.
 * See CLAUDE.md for the historical oracle command. Aegis uses test:parity instead.
 */
import { readFileSync } from "node:fs"
import { localSubgraphUrl } from "@cobuilders/safenet-core"
import { participationFromHours, type ConsensusHourRow, type ValidatorHourRow } from "@cobuilders/safenet-core/parity"

const ENDPOINT = process.env.SUBGRAPH_URL || localSubgraphUrl("gnosis", process.env.GRAPH_NODE_PORT ?? "8000")
const ORACLE = process.env.ORACLE ?? "/tmp/oracle-beta.json"
const PROGRAMME = process.env.PROGRAMME ?? "beta"
const PAGE = 1000

interface OracleRun {
  programme: string
  windowDays: number
  window: { start: string; end: string; fromBlock: string; toBlock: string }
  ceremonies: { all: number; attestations: number }
  participation: { label: string; address: string; ours: number; rounds: number }[]
}
interface State {
  _meta: { block: { number: number }; hasIndexingErrors: boolean }
  consensus: { validators: { id: string }[]; validatorCount: number } | null
  consensusHours: { hour: number }[]
}

async function query<T>(text: string): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }), signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`subgraph HTTP ${response.status}; check SUBGRAPH_URL`)
  const answer = await response.json().catch(() => ({})) as { data?: T; errors?: unknown[] }
  if (answer.errors?.length || !answer.data) throw new Error("subgraph query failed; check SUBGRAPH_URL and its schema")
  return answer.data
}

async function main(): Promise<void> {
  const oracle = JSON.parse(readFileSync(ORACLE, "utf8")) as OracleRun
  if (PROGRAMME !== "beta" || oracle.programme !== PROGRAMME) {
    throw new Error("the metrics oracle scans Beta only; use a Beta oracle or test:parity for Aegis")
  }
  if (!oracle.window) throw new Error("oracle has no explicit window; regenerate it with --beta-window")
  const window = { start: new Date(oracle.window.start), end: new Date(oracle.window.end) }
  const from = window.start.getTime() / 1000
  const to = window.end.getTime() / 1000
  const days = Number(process.env.ORACLE_DAYS ?? "14")
  if (!Number.isInteger(days) || days <= 0 || oracle.windowDays !== days || to - from !== days * 86_400 ||
      !Number.isInteger(from) || !Number.isInteger(to) || from % 3600 !== 0 || to % 3600 !== 0) {
    throw new Error("oracle window must cover ORACLE_DAYS whole days with both boundaries on the hour")
  }
  const first = BigInt(oracle.window.fromBlock)
  const last = BigInt(oracle.window.toBlock)
  if (first < 0n || last < first) throw new Error("invalid oracle block boundaries")
  if (!Number.isSafeInteger(oracle.ceremonies.attestations) || oracle.ceremonies.attestations <= 0) {
    throw new Error("the oracle contains no attestation ceremonies to compare")
  }

  const state = await query<State>(`{
    _meta { block { number } hasIndexingErrors }
    consensus(id: "beta") { validatorCount validators(first: ${PAGE}) { id } }
    consensusHours(first: 1, orderBy: hour, orderDirection: asc, where: { programme: "beta" }) { hour }
  }`)
  if (state._meta.hasIndexingErrors) throw new Error("subgraph reports indexing errors")
  const indexed = state._meta.block.number
  if (BigInt(indexed) < last) throw new Error("subgraph has not indexed through the oracle window")
  // A window beginning at the deployment boundary can lose shares from earlier blocks.
  // Require two complete hours of indexed ceremonies before comparing the requested window.
  // The first bucket can itself be partial, so do not count it as a complete hour.
  if (!state.consensusHours[0] || state.consensusHours[0].hour + 3600 > from - 7200) {
    throw new Error("subgraph starts too late for this oracle window; deploy a wider window")
  }
  const consensus = state.consensus
  if (!consensus) throw new Error("subgraph has no Beta consensus")
  if (consensus.validators.length >= PAGE || consensus.validators.length !== consensus.validatorCount) {
    throw new Error("subgraph validator list is incomplete")
  }

  // Every page is pinned to the same block, including the validator list. The first query
  // discovers that block; the second reads membership from the same snapshot as the buckets.
  const pinned = await query<{ consensus: State["consensus"] }>(`{
    consensus(id: "beta", block: { number: ${indexed} }) { validatorCount validators(first: ${PAGE}) { id } }
  }`)
  if (!pinned.consensus || pinned.consensus.validators.length >= PAGE ||
      pinned.consensus.validators.length !== pinned.consensus.validatorCount) {
    throw new Error("subgraph validator list is incomplete")
  }
  async function page<T extends { id: string }>(entity: string, fields: string): Promise<T[]> {
    const rows: T[] = []
    for (let after = ""; ;) {
      const result = await query<Record<string, T[]>>(`{
        ${entity}(first: ${PAGE}, orderBy: id, orderDirection: asc, block: { number: ${indexed} },
          where: { programme: "beta", hour_gte: ${from}, hour_lte: ${to}, id_gt: "${after}" }) {
          id ${fields}
        }
      }`)
      const got = result[entity]
      if (!got) throw new Error(`subgraph returned no ${entity}`)
      if (got.some((r, i) => r.id <= (i === 0 ? after : got[i - 1]!.id))) {
        throw new Error("subgraph page did not advance in id order")
      }
      rows.push(...got)
      if (got.length < PAGE) return rows
      after = got[got.length - 1]!.id
    }
  }
  const [hours, validatorHours] = await Promise.all([
    page<ConsensusHourRow & { id: string }>("consensusHours", "hour attestationCeremonies attestationCeremoniesOnTheHour"),
    page<Omit<ValidatorHourRow, "validator"> & { id: string; validator: { id: string } }>(
      "validatorHours", "hour attended attendedOnTheHour validator { id }",
    ),
  ])
  const counts = participationFromHours({ window, consensus: hours,
    validators: validatorHours.map((r) => ({ ...r, validator: r.validator.id })),
  })
  // Membership comes from the programme, even when a validator never attended a ceremony.
  const attended = new Map(pinned.consensus.validators.map((v) => [v.id.toLowerCase(), 0n]))
  for (const [id, n] of counts.attended) {
    if (!attended.has(id)) throw new Error("hourly row names a validator outside the programme")
    attended.set(id, n)
  }
  let failures = 0
  function check(label: string, ok: boolean, detail: string): void {
    if (!ok) failures++
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${detail}`)
  }
  console.log(`  Beta ${window.start.toISOString()} .. ${window.end.toISOString()}, both inclusive`)
  console.log(`  oracle blocks ${first} .. ${last}; subgraph snapshot ${indexed}`)
  check("attestation ceremonies", counts.ceremonies === BigInt(oracle.ceremonies.attestations),
    `oracle ${oracle.ceremonies.attestations}, subgraph ${counts.ceremonies}`)
  check("validator count", oracle.participation.length === attended.size,
    `oracle ${oracle.participation.length}, subgraph ${attended.size}`)
  const oracleAddresses = new Set(oracle.participation.map((p) => p.address.toLowerCase()))
  check("unique oracle validators", oracleAddresses.size === oracle.participation.length, `${oracleAddresses.size}`)
  for (const p of oracle.participation) {
    const actual = attended.get(p.address.toLowerCase())
    const valid = Number.isSafeInteger(p.rounds) && p.rounds >= 0 && p.rounds <= oracle.ceremonies.attestations
    check(p.label, valid && actual !== undefined && actual === BigInt(p.rounds) &&
      p.ours === p.rounds / oracle.ceremonies.attestations,
    `attended oracle ${p.rounds}, subgraph ${actual ?? "missing"}`)
  }
  console.log(failures ? `  ${failures} check(s) FAILED` : "  the subgraph agrees with the oracle")
  if (failures) process.exitCode = 1
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "differential failed")
  process.exitCode = 1
})
