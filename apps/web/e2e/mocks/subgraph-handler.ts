/**
 * Mocked subgraph endpoints, answered per GraphQL operation name.
 *
 * playwright.config.ts points VITE_SUBGRAPH_URL_MAINNET and VITE_SUBGRAPH_URL_GNOSIS at
 * https://mock-subgraph.test/<chain>. The figures here deliberately differ from the mocked
 * contract reads (12,345 SAFE staked against the RPC mock's 10,000), so a test can tell which
 * source a number on screen came from.
 */
import type { Route } from "@playwright/test"
import { BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { AMOUNTS, VALIDATORS } from "../fixtures/test-data"

/** ok: fresh answers. fail: HTTP 500. stale: answers whose last block is an hour old. */
export type SubgraphMode = "ok" | "fail" | "stale"

export interface MockSubgraphState {
  mainnet: SubgraphMode
  gnosis: SubgraphMode
}

export function createMockSubgraphState(): MockSubgraphState {
  return { mainnet: "ok", gnosis: "ok" }
}

const SAFE = 10n ** 18n
const DAY = 86_400

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

function mainnet(operation: string, mode: SubgraphMode): unknown {
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
  throw new Error(`no mock for mainnet ${operation}`)
}

function gnosis(operation: string, mode: SubgraphMode): unknown {
  if (operation !== "ConsensusWindow") throw new Error(`no mock for gnosis ${operation}`)
  // Beta's last days, as the live subgraph holds them: attestations on the Beta Consensus contract
  // stopped on Beta's last day, with one stray ceremony the day after. The first day is partial
  // and dropped, and the stray is not a Beta day, so the window is the 14 days to Beta's end,
  // whatever today is, and the Overview dates it as Beta. The mock answers whatever the query's
  // date bound, so the stray reaches the client, which must leave it out.
  const betaEnd = utcDayMs(BETA_END_DAY) / 1000
  const dates = Array.from({ length: 16 }, (_, i) => betaEnd - (15 - i) * DAY)
  const stray = betaEnd + DAY
  const buckets = Array.from({ length: 65 }, (_, i) => (i === SUBGRAPH_FIGURES.latencyMedianBlocks ? "100" : "0"))
  return {
    _meta: meta(SUBGRAPH_FIGURES.gnosisBlock, mode),
    firstDay: [{ date: dates[0] }],
    // Newest first, as the query orders them.
    consensusDays: [
      { date: stray, attestations: "1", attestationCeremonies: "1", latencyBuckets: buckets },
      ...[...dates].reverse().map((date) => ({
        date,
        attestations: String(SUBGRAPH_FIGURES.attestationsPerDay),
        attestationCeremonies: "1000",
        latencyBuckets: buckets,
      })),
    ],
    validatorDays: [
      { date: stray, attended: "1", validator: { id: VALIDATORS.validatorA } },
      ...[...dates].reverse().flatMap((date) => [
        { date, attended: "1000", validator: { id: VALIDATORS.validatorA } },
        { date, attended: "990", validator: { id: VALIDATORS.validatorB } },
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
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    const data = chain === "gnosis" ? gnosis(operationName ?? "", mode) : mainnet(operationName ?? "", mode)
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) })
  }
}
