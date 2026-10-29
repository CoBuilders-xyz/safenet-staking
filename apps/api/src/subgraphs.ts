import { GNOSIS_AEGIS_FIRST_COMPLETE_DAY, GNOSIS_INDEXED_PROGRAMME, utcDayMs } from "@cobuilders/safenet-core"
import type { Address } from "viem"
import { ApiError, META, array, boolean, graph, integer, malformed, object, string, uint, type Fetcher, type Result } from "./upstream.js"

export type Endpoints = Pick<Env, "SUBGRAPH_URL_MAINNET" | "SUBGRAPH_URL_GNOSIS">
export const DETAIL = `query Validator($id: ID!) { ${META} validator(id: $id) {
  address isRegistered totalStaked stakersCurrent stakersEver registeredAtTimestamp
} }`
export async function detail(fetcher: Fetcher, env: Endpoints, target: Address, now: number) {
  const result = await graph(fetcher, env.SUBGRAPH_URL_MAINNET, DETAIL, { id: target.toLowerCase() }, now, "mainnet")
  if (!result.data.validator) throw new ApiError("not_indexed", 503, "The validator has not been indexed on Mainnet.")
  const row = object(result.data.validator)
  if (string(row.address).toLowerCase() !== target.toLowerCase()) throw malformed()
  return { data: {
    registered: boolean(row.isRegistered), totalStaked: uint(row.totalStaked),
    stakersCurrent: integer(row.stakersCurrent), stakersEver: integer(row.stakersEver),
    registeredAtTimestamp: row.registeredAtTimestamp === null ? null : uint(row.registeredAtTimestamp),
  }, sources: [result.freshness], expiresAt: result.expiresAt }
}
export const STATS_MAINNET = `query SystemMainnet { ${META} network(id: "1") {
 totalStaked pendingWithdrawals rewardsClaimed activeValidators stakersCurrent stakersEver delegationsCurrent rewardPeriods
} }`
export const STATS_GNOSIS = `query SystemGnosis($programme: String!) { ${META}
 consensuses(first: 1, where: { programme: $programme }) {
  programme attestationCeremonies attestations proposals validatorCount
 }
}`
export async function stats(fetcher: Fetcher, env: Endpoints, now: number) {
  const [mainnet, gnosis] = await Promise.all([
    graph(fetcher, env.SUBGRAPH_URL_MAINNET, STATS_MAINNET, {}, now, "mainnet"),
    graph(fetcher, env.SUBGRAPH_URL_GNOSIS, STATS_GNOSIS, { programme: GNOSIS_INDEXED_PROGRAMME }, now, "gnosis"),
  ])
  if (!mainnet.data.network || !array(gnosis.data.consensuses).length) throw new ApiError("not_indexed", 503, "Network totals have not been indexed.")
  const n = object(mainnet.data.network), g = object(array(gnosis.data.consensuses)[0])
  if (g.programme !== GNOSIS_INDEXED_PROGRAMME) throw malformed()
  return {
    data: {
      mainnet: { totalStaked: uint(n.totalStaked), pendingWithdrawals: uint(n.pendingWithdrawals), rewardsClaimed: uint(n.rewardsClaimed),
        registeredValidators: integer(n.activeValidators), stakersCurrent: integer(n.stakersCurrent), stakersEver: integer(n.stakersEver),
        delegationsCurrent: integer(n.delegationsCurrent), rewardPeriods: integer(n.rewardPeriods) },
      gnosis: { programme: GNOSIS_INDEXED_PROGRAMME, attestationCeremonies: uint(g.attestationCeremonies),
        attestations: uint(g.attestations), proposals: uint(g.proposals), validatorCount: integer(g.validatorCount) },
    },
    sources: [mainnet.freshness, gnosis.freshness], expiresAt: Math.min(mainnet.expiresAt, gnosis.expiresAt),
  }
}
export const SIGNERS = `query Signers($id: ID!, $programme: String!) { ${META}
 signingValidator(id: $id) { id staker }
 consensuses(first: 1, where: { programme: $programme }) { programme validators(first: 1000) { id } }
}`
// Pin every page to the same hash. No skip pagination or silent 1,000-row truncation.
export const HISTORY = `query History($hash: Bytes!, $programme: String!, $signer: String!, $since: Int!, $until: Int!, $after: Int!) {
 _meta(block: { hash: $hash }) { block { number hash timestamp } hasIndexingErrors }
 consensusDays(first: 500, block: { hash: $hash }, where: { programme: $programme, date_gte: $since, date_lt: $until, date_gt: $after }, orderBy: date, orderDirection: asc) {
  date programme attestationCeremonies
 }
 validatorDays(first: 500, block: { hash: $hash }, where: { programme: $programme, validator: $signer, date_gte: $since, date_lt: $until, date_gt: $after }, orderBy: date, orderDirection: asc) {
  date programme attended
 }
}`
export type Window = "7d" | "30d" | "all"
export async function history(fetcher: Fetcher, env: Endpoints, target: Address, window: Window, now: number): Promise<Result<Record<string, unknown>>> {
  const initial = await graph(fetcher, env.SUBGRAPH_URL_GNOSIS, SIGNERS, { id: target.toLowerCase(), programme: GNOSIS_INDEXED_PROGRAMME }, now, "gnosis")
  if (!initial.data.signingValidator) throw new ApiError("not_indexed", 503, "The signing address has not been indexed.")
  const signer = object(initial.data.signingValidator), signerId = string(signer.id)
  if (signerId !== target.toLowerCase()) throw malformed()
  // SEF's validator addresses are signing addresses. ValidatorStakerSet names a different owner;
  // never use that owner to substitute for the signer in participation queries.
  const programmes = array(initial.data.consensuses)
  if (!programmes.length) throw new ApiError("not_indexed", 503, "The current programme has not been indexed.")
  const programme = object(programmes[0])
  if (programme.programme !== GNOSIS_INDEXED_PROGRAMME) throw malformed()
  if (!array(programme.validators).some(v => object(v).id === signerId)) {
    throw new ApiError("participation_unconfirmed", 503, "Participation in the current programme is unconfirmed.")
  }
  // Completed UTC days only, bounded by the indexed block, not the wall clock.
  const until = Math.floor(initial.freshness.blockTimestamp / 86400) * 86400
  const coverage = utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000
  const requestedSince = window === "all" ? coverage : until - (window === "7d" ? 7 : 30) * 86400
  const since = Math.max(coverage, requestedSince)
  const denominators = new Map<number, bigint>(), numerators = new Map<number, bigint>()
  let after = since - 1
  for (let page = 0; ; page++) {
    if (page >= 50) throw new ApiError("history_too_large", 503, "The history exceeds the response limit.")
    const result = await graph(fetcher, env.SUBGRAPH_URL_GNOSIS, HISTORY, {
      hash: initial.freshness.blockHash, programme: GNOSIS_INDEXED_PROGRAMME, signer: signerId, since, until, after,
    }, now, "gnosis", initial.freshness.blockHash)
    const consensus = array(result.data.consensusDays), days = array(result.data.validatorDays)
    for (const [rows, map, field] of [[consensus, denominators, "attestationCeremonies"], [days, numerators, "attended"]] as const) {
      let previous = after
      for (const raw of rows) {
        const row = object(raw), day = integer(row.date)
        if (row.programme !== GNOSIS_INDEXED_PROGRAMME || day <= previous || day < since || day >= until || day % 86400 !== 0) throw malformed()
        map.set(day, BigInt(uint(row[field])))
        previous = day
      }
    }
    if (consensus.length < 500 && days.length < 500) break
    // Advance only through the smaller full page; re-read the other tail on the next page.
    const ends = [consensus, days].filter(rows => rows.length === 500).map(rows => integer(object(rows.at(-1)).date))
    after = Math.min(...ends)
  }
  for (const [day, attended] of numerators) if (attended > (denominators.get(day) ?? 0n)) throw malformed()
  const points = []
  for (let date = since; date < until; date += 86400) {
    const ceremonies = denominators.get(date) ?? 0n, attended = numerators.get(date) ?? 0n
    points.push({ date, ceremonies: ceremonies.toString(), attended: attended.toString(),
      participation: ceremonies === 0n ? null : Number(attended * 1_000_000_000n / ceremonies) / 1_000_000_000 })
  }
  return { data: { address: target, signingAddress: signerId, programme: GNOSIS_INDEXED_PROGRAMME, window,
    since, until, completeDaysOnly: true, coverageStartsAt: coverage, points },
    sources: [initial.freshness], expiresAt: initial.expiresAt }
}

export const EVENTS = `query Events($id: String!, $stakeAfter: ID!, $withdrawalAfter: ID!, $block: Block_height) {
 _meta(block: $block) { block { number hash timestamp } hasIndexingErrors }
 stakes(first: 100, block: $block, where: { validator: $id, id_gt: $stakeAfter }, orderBy: id, orderDirection: asc) {
  id staker amount blockNumber timestamp transactionHash
 }
 withdrawals(first: 100, block: $block, where: { validator: $id, id_gt: $withdrawalAfter }, orderBy: id, orderDirection: asc) {
  id staker amount claimed initiatedAtBlock initiatedAtTimestamp initiatedTxHash claimedAtBlock claimedAtTimestamp claimedTxHash
 }
}`
interface Cursor { address: string; hash: string; stake: string; withdrawal: string }
export function decodeCursor(encoded: string | undefined, target: Address): Cursor | undefined {
  if (!encoded) return undefined
  try {
    if (encoded.length > 1500) throw new Error()
    const c = object(JSON.parse(atob(encoded)))
    if (c.address !== target.toLowerCase() || typeof c.hash !== "string" || !/^0x[\da-f]{64}$/i.test(c.hash)
      || typeof c.stake !== "string" || typeof c.withdrawal !== "string" || c.stake.length > 200 || c.withdrawal.length > 200) throw new Error()
    return { address: c.address, hash: c.hash, stake: c.stake, withdrawal: c.withdrawal }
  } catch { throw new ApiError("invalid_cursor", 400, "The events cursor is invalid for this validator.") }
}
export async function events(fetcher: Fetcher, env: Endpoints, target: Address, cursor: Cursor | undefined, now: number) {
  const r = await graph(fetcher, env.SUBGRAPH_URL_MAINNET, EVENTS, {
    id: target.toLowerCase(), stakeAfter: cursor?.stake ?? "", withdrawalAfter: cursor?.withdrawal ?? "",
    block: cursor ? { hash: cursor.hash } : null,
  }, now, "mainnet", cursor?.hash)
  const stakes = array(r.data.stakes).map(raw => {
    const v = object(raw)
    return { id: string(v.id), staker: string(v.staker), amount: uint(v.amount), blockNumber: uint(v.blockNumber), timestamp: uint(v.timestamp), transactionHash: string(v.transactionHash) }
  })
  const withdrawals = array(r.data.withdrawals).map(raw => {
    const v = object(raw), claimed = boolean(v.claimed)
    return { id: string(v.id), staker: string(v.staker), amount: uint(v.amount), claimed,
      initiatedAtBlock: uint(v.initiatedAtBlock), initiatedAtTimestamp: uint(v.initiatedAtTimestamp), initiatedTxHash: string(v.initiatedTxHash),
      claimedAtBlock: claimed ? uint(v.claimedAtBlock) : null, claimedAtTimestamp: claimed ? uint(v.claimedAtTimestamp) : null,
      claimedTxHash: claimed ? string(v.claimedTxHash) : null }
  })
  const more = stakes.length === 100 || withdrawals.length === 100
  const nextCursor = more ? btoa(JSON.stringify({ address: target.toLowerCase(), hash: r.freshness.blockHash,
    stake: stakes.at(-1)?.id ?? cursor?.stake ?? "", withdrawal: withdrawals.at(-1)?.id ?? cursor?.withdrawal ?? "" })) : null
  return { data: { address: target, stakes, withdrawals, nextCursor, order: "id ascending within each collection" }, sources: [r.freshness], expiresAt: r.expiresAt }
}
