/**
 * Mocked subgraph endpoints, answered per GraphQL operation name.
 *
 * playwright.config.ts points VITE_SUBGRAPH_URL_MAINNET and VITE_SUBGRAPH_URL_GNOSIS at
 * https://mock-subgraph.test/<chain>. The figures here deliberately differ from the mocked
 * contract reads (12,345 SAFE staked against the RPC mock's 10,000), so a test can tell which
 * source a number on screen came from.
 */
import type { Route } from "@playwright/test"
import { BETA_END_DAY, GNOSIS_AEGIS_FIRST_COMPLETE_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { AMOUNTS, VALIDATORS } from "../fixtures/test-data"

/**
 * ok: fresh answers. fail: HTTP 500. stale: answers whose last block is an hour old. empty: fresh
 * answers from a deployment that has indexed nothing yet, for the validator queries and the
 * consensus window; the other operations answer as ok.
 */
export type SubgraphMode = "ok" | "fail" | "stale" | "empty"

export interface MockSubgraphState {
  mainnet: SubgraphMode
  gnosis: SubgraphMode
  /** Whether the Gnosis subgraph holds Aegis days. False: it answers an Aegis query with no row. */
  gnosisAegis: boolean
  gnosisZeroAttendance: boolean
}

export function createMockSubgraphState(): MockSubgraphState {
  return { mainnet: "ok", gnosis: "ok", gnosisAegis: true, gnosisZeroAttendance: false }
}

const SAFE = 10n ** 18n
const DAY = 86_400
const HOUR = 3_600

export const SUBGRAPH_FIGURES = {
  mainnetBlock: 25_900_000,
  gnosisBlock: 48_600_000,
  totalStaked: 12_345n * SAFE,
  validatorA: 7_000n * SAFE,
  validatorB: 5_345n * SAFE,
  stakers: 37,
  rewardsClaimed: 650n * SAFE,
  attestationsPerDay: 4_800,
  latencyMedianBlocks: 4,
  stakedIn30d: 300n * SAFE,
} as const

function meta(block: number, mode: SubgraphMode) {
  const age = mode === "stale" ? 3600 : 12
  return { block: { number: block, timestamp: Math.floor(Date.now() / 1000) - age }, hasIndexingErrors: false }
}

function mainnet(operation: string, mode: SubgraphMode, variables: Record<string, unknown>): unknown {
  const _meta = meta(SUBGRAPH_FIGURES.mainnetBlock, mode)
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY
  switch (operation) {
    case "NetworkTotals":
      return {
        _meta,
        network: {
          totalStaked: SUBGRAPH_FIGURES.totalStaked.toString(),
          stakersCurrent: SUBGRAPH_FIGURES.stakers,
          rewardsClaimed: SUBGRAPH_FIGURES.rewardsClaimed.toString(),
          currentRoot: null,
        },
      }
    case "ValidatorStakes":
      return {
        _meta,
        validators: [
          { id: VALIDATORS.validatorA, totalStaked: SUBGRAPH_FIGURES.validatorA.toString(), stakersCurrent: 25 },
          { id: VALIDATORS.validatorB, totalStaked: SUBGRAPH_FIGURES.validatorB.toString(), stakersCurrent: 12 },
          // Withdrawn: still registered on chain, with nothing staked.
          { id: VALIDATORS.validatorC, totalStaked: "0", stakersCurrent: 0 },
        ],
      }
    case "RecentDays":
      return {
        _meta,
        dayDatas: [
          { date: today - 3 * DAY, totalStaked: "0", stakedIn: (200n * SAFE).toString(), withdrawnOut: "0", rewardsClaimed: "0", stakeCount: 2, withdrawalCount: 0 },
          { date: today - DAY, totalStaked: "0", stakedIn: (100n * SAFE).toString(), withdrawnOut: AMOUNTS.pendingWithdrawalAmount.toString(), rewardsClaimed: "0", stakeCount: 1, withdrawalCount: 1 },
        ],
      }
  }
  const validators = mainnetValidators()
  switch (operation) {
    case "ValidatorDirectory":
      return { _meta, validators: mode === "empty" ? [] : validators.map((v) => v.row) }
    case "ValidatorActivity": {
      const v = mode === "empty" ? undefined : validators.find((x) => x.row.id === variables.id)
      // One page holds every row here, so a later page, after a cursor, is empty.
      const first = variables.stakesAfter === "" && variables.withdrawalsAfter === ""
      if (!v) return { _meta, validator: null, stakes: [], withdrawals: [] }
      return { _meta, validator: v.row, stakes: first ? v.stakes : [], withdrawals: first ? v.withdrawals : [] }
    }
  }
  throw new Error(`no mock for mainnet ${operation}`)
}

/** Unix seconds of the validators' registration, as on Mainnet: block 24,741,826. */
export const REGISTERED_AT = 1_774_529_219
const STAKE_START = 1_775_001_600 // 2026-04-01 00:00 UTC

const hex = (n: number, bytes: number) => `0x${n.toString(16).padStart(bytes * 2, "0")}`

/**
 * Each validator as the Mainnet subgraph serves it, with its stakes and withdrawals. Validator A:
 * 26 delegators, one stake a day, the last of them unstaked in full and claimed, so 25 now and
 * 26 ever, the count ValidatorStakes reports. B: 12 delegators. C: registered, with no stake.
 */
function mainnetValidators() {
  const stakesOf = (count: number, seed: number) =>
    Array.from({ length: count }, (_, i) => {
      const tx = hex(seed + i, 32)
      return {
        id: `${tx}-${i}`,
        staker: hex(seed + i, 20),
        amount: (100n * SAFE).toString(),
        blockNumber: String(24_800_000 + i * 7_200),
        timestamp: String(STAKE_START + i * DAY),
        transactionHash: tx,
      }
    })
  const a = stakesOf(26, 0xa000)
  const b = stakesOf(12, 0xb000)
  const leaver = a[a.length - 1]
  const row = (id: string, current: number, ever: number, staked: bigint) => ({
    id,
    isRegistered: true,
    totalStaked: staked.toString(),
    stakersCurrent: current,
    stakersEver: ever,
    registeredAtBlock: "24741826",
    registeredAtTimestamp: String(REGISTERED_AT),
  })
  return [
    {
      row: row(VALIDATORS.validatorA, 25, 26, SUBGRAPH_FIGURES.validatorA),
      stakes: a,
      withdrawals: [
        {
          id: "41",
          staker: leaver.staker,
          amount: leaver.amount,
          claimed: true,
          initiatedAtBlock: "25000000",
          initiatedAtTimestamp: String(STAKE_START + 30 * DAY),
          initiatedTxHash: hex(0xa100, 32),
          claimedAtBlock: "25050000",
          claimedAtTimestamp: String(STAKE_START + 37 * DAY),
          claimedTxHash: hex(0xa101, 32),
        },
      ],
    },
    { row: row(VALIDATORS.validatorB, 12, 12, SUBGRAPH_FIGURES.validatorB), stakes: b, withdrawals: [] },
    { row: row(VALIDATORS.validatorC, 0, 0, 0n), stakes: [], withdrawals: [] },
  ]
}

/**
 * One validator's programme-tagged buckets. Daily BigInt counts are strings; hourly counts
 * are Ints. The route applies the query's unique id cursors and page limit. The network attests 40 ceremonies an hour, 960 a day. A attends all of them; B misses
 * one in each hour from 18:00 UTC, 6 a day; C has no bucket at all.
 */
function validatorParticipation(validator: string, aegis: boolean, zeroAttendance: boolean) {
  const first = utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000
  const last = aegis ? Math.floor(Date.now() / 1000 / DAY) * DAY - DAY : utcDayMs(BETA_END_DAY) / 1000
  const programme = aegis ? "aegis" : "beta"
  const dates = Array.from({ length: aegis ? (last - first) / DAY + 1 : 16 }, (_, i) => last - i * DAY)
  const hours = Array.from({ length: aegis ? (last - first + DAY) / HOUR : 8 * 24 }, (_, i) => last + 23 * HOUR - i * HOUR)
  const attendedDay = validator === VALIDATORS.validatorA ? 960 : 954
  const attendedHour = (h: number) => (validator === VALIDATORS.validatorA || (h % DAY) / HOUR < 18 ? 40 : 39)
  const listed = !zeroAttendance && (validator === VALIDATORS.validatorA || validator === VALIDATORS.validatorB)
  return {
    memberships: [{ programme, validatorCount: aegis ? 3 : 2, validators: (aegis ? Object.values(VALIDATORS) : [VALIDATORS.validatorA, VALIDATORS.validatorB]).map((id) => ({ id })) }],
    consensusDays: dates.map((date) => ({ id: `${programme}-${date}`, programme, date, attestationCeremonies: "960" })),
    validatorDays: listed ? dates.map((date) => ({ id: `${programme}-${validator}-${date}`, programme, date, attended: String(attendedDay) })) : [],
    consensusHours: hours.map((hour) => ({ id: `${programme}-${hour}`, programme, hour, attestationCeremonies: 40 })),
    validatorHours: listed ? hours.map((hour) => ({ id: `${programme}-${validator}-${hour}`, programme, hour, attended: attendedHour(hour) })) : [],
  }
}

/**
 * The Gnosis subgraph files every row under a programme, and the query names one.
 *
 * Aegis: the 16 days to today, as the live subgraph holds them while Aegis attests. The first day
 * is partial and today is running, so the Overview counts the 14 days to yesterday. With
 * `gnosisAegis` false the Aegis rows are empty, as on a deployment that holds no Aegis day.
 *
 * Beta: its last days. Attestations on the Beta Consensus contract stopped on Beta's last day,
 * with one stray ceremony the day after. The first day is partial and dropped, and the stray is
 * not a Beta day, so the window is the 14 days to Beta's end, and the Overview dates it as Beta.
 * The mock answers whatever the query's date bound, so the stray reaches the client, which must
 * leave it out.
 *
 * Both carry the same daily figures, so a test reads the same numbers from either.
 */
function gnosis(operation: string, mode: SubgraphMode, variables: Record<string, unknown>, aegis: boolean, zeroAttendance: boolean): unknown {
  const programme = variables.programme
  if (operation === "ValidatorParticipation") {
    const _meta = meta(SUBGRAPH_FIGURES.gnosisBlock, mode)
    if (mode === "empty") return { _meta, consensusDays: [], validatorDays: [], consensusHours: [], validatorHours: [], memberships: [] }
    const history = validatorParticipation(String(variables.validator), aegis, zeroAttendance)
    const page = <T extends { id: string }>(rows: T[], after: unknown) => rows
      .filter((row) => row.id > String(after ?? ""))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1000)
    return {
      _meta, ...history,
      consensusDays: page(history.consensusDays, variables.daysAfter),
      validatorDays: page(history.validatorDays, variables.validatorDaysAfter),
      consensusHours: page(history.consensusHours, variables.hoursAfter),
      validatorHours: page(history.validatorHours, variables.validatorHoursAfter),
    }
  }
  if (mode === "empty") return { _meta: meta(SUBGRAPH_FIGURES.gnosisBlock, mode), firstDay: [], programmeConsensus: [], consensusDays: [], validatorDays: [] }
  if (operation !== "ConsensusWindow") throw new Error(`no mock for gnosis ${operation}`)
  const _meta = meta(SUBGRAPH_FIGURES.gnosisBlock, mode)
  if (programme === "aegis" && !aegis) return { _meta, firstDay: [], programmeConsensus: [], consensusDays: [], validatorDays: [] }
  if (programme !== "aegis" && programme !== "beta") throw new Error(`no mock for the programme ${String(programme)}`)
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY
  const last = programme === "aegis" ? today : utcDayMs(BETA_END_DAY) / 1000
  const dates = Array.from({ length: 16 }, (_, i) => last - (15 - i) * DAY)
  const strays = programme === "beta" ? [last + DAY] : []
  const buckets = Array.from({ length: 65 }, (_, i) => (i === SUBGRAPH_FIGURES.latencyMedianBlocks ? "100" : "0"))
  return {
    _meta,
    programmeConsensus: [{ validatorCount: 3, validators: Object.values(VALIDATORS).map((id) => ({ id })) }],
    firstDay: [{ date: dates[0] }],
    // Newest first, as the query orders them.
    consensusDays: [
      ...strays.map((date) => ({ date, attestations: "1", attestationCeremonies: "1", latencyBuckets: buckets })),
      ...[...dates].reverse().map((date) => ({
        date,
        attestations: String(SUBGRAPH_FIGURES.attestationsPerDay),
        attestationCeremonies: "1000",
        latencyBuckets: buckets,
      })),
    ],
    validatorDays: [
      ...strays.map((date) => ({ date, attended: "1", validator: { id: VALIDATORS.validatorA } })),
      ...[...dates].reverse().flatMap((date) => [
        { date, attended: "1000", validator: { id: VALIDATORS.validatorA } },
        ...(zeroAttendance ? [] : [{ date, attended: "990", validator: { id: VALIDATORS.validatorB } }]),
        { date, attended: "980", validator: { id: VALIDATORS.validatorC } },
      ]),
    ],
  }
}

export function createSubgraphHandler(state: MockSubgraphState) {
  return async (route: Route) => {
    const chain = new URL(route.request().url()).pathname.includes("gnosis") ? "gnosis" : "mainnet"
    const mode = state[chain]
    if (mode === "fail") {
      await route.fulfill({ status: 500, contentType: "text/plain", body: "subgraph unavailable" })
      return
    }
    const { operationName, variables = {} } = route.request().postDataJSON() as { operationName?: string; variables?: Record<string, unknown> }
    const data = chain === "gnosis"
      ? gnosis(operationName ?? "", mode, variables, state.gnosisAegis, state.gnosisZeroAttendance)
      : mainnet(operationName ?? "", mode, variables)
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) })
  }
}
