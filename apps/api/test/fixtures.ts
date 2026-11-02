import { GNOSIS_SNAPSHOT, GNOSIS_INDEXED_PROGRAMME, SEF_DATA, SUBGRAPH_ENDPOINTS, utcDayMs, AEGIS_START_DAY } from "@cobuilders/safenet-core"
import type { Fetcher } from "../src/upstream.js"

export const TARGET = GNOSIS_SNAPSHOT.participation[0]!.address
export const OTHER = GNOSIS_SNAPSHOT.participation[1]!.address
export const NOW = utcDayMs(AEGIS_START_DAY) + 16 * 86400_000 + 12 * 3600_000
export const HASH = `0x${"a".repeat(64)}`
export const SHA = "b".repeat(40)
export const ENV = { SUBGRAPH_URL_MAINNET: SUBGRAPH_ENDPOINTS.mainnet, SUBGRAPH_URL_GNOSIS: SUBGRAPH_ENDPOINTS.gnosis }
export const raw = { address: TARGET, label: "Manual label must never escape", commission: 0.05, is_active: false, participation_rate_14d: null }
export const meta = { block: { number: 100, hash: HASH, timestamp: NOW / 1000 - 20 }, hasIndexingErrors: false }
export interface FixtureOptions {
  publication?: number
  rows?: unknown
  graph?: (query: string, variables: Record<string, unknown>) => Record<string, unknown>
}
export function upstream(options: FixtureOptions = {}): Fetcher {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (url === SEF_DATA.validatorInfoCommits) return Response.json([{ sha: SHA, commit: { committer: { date: new Date(options.publication ?? NOW - 1000).toISOString() } } }])
    if (url.includes(`/${SHA}/assets/`)) return Response.json(options.rows ?? [raw])
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
    const data = options.graph?.(query, variables) ?? graphData(query)
    return Response.json({ data: { _meta: meta, ...data } })
  }) as Fetcher
}
export function graphData(query: string): Record<string, unknown> {
  if (query.includes("query SystemMainnet")) return { network: { totalStaked: "1000000000000000000000000", pendingWithdrawals: "0", rewardsClaimed: "100", activeValidators: 1, stakersCurrent: 1, stakersEver: 2, delegationsCurrent: 1, rewardPeriods: 1 } }
  if (query.includes("query SystemGnosis")) return { consensuses: [{ programme: GNOSIS_INDEXED_PROGRAMME, attestationCeremonies: "100", attestations: "101", proposals: "102", validatorCount: 1 }] }
  if (query.includes("query Validator(")) return { validator: { address: TARGET, isRegistered: true, totalStaked: "900719925474099300000", stakersCurrent: 1, stakersEver: 2, registeredAtTimestamp: null, firstSeenAtTimestamp: "1774528907" } }
  if (query.includes("query Signers")) return { signingValidator: { id: TARGET.toLowerCase(), staker: OTHER.toLowerCase() }, consensuses: [{ programme: GNOSIS_INDEXED_PROGRAMME, validators: [{ id: TARGET.toLowerCase() }] }] }
  if (query.includes("query History")) {
    const date = Math.floor(NOW / 86400_000) * 86400 - 86400
    return { consensusDays: [{ date, programme: GNOSIS_INDEXED_PROGRAMME, attestationCeremonies: "10" }], validatorDays: [{ date, programme: GNOSIS_INDEXED_PROGRAMME, attended: "8" }] }
  }
  if (query.includes("query Events")) return { stakes: [], withdrawals: [] }
  throw new Error("Unexpected fixture query")
}
