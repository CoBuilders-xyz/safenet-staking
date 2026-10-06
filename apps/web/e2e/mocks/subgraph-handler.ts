/**
 * Mocked subgraph endpoints, answered per GraphQL operation name.
 *
 * playwright.config.ts points VITE_SUBGRAPH_URL_MAINNET and VITE_SUBGRAPH_URL_GNOSIS at
 * https://mock-subgraph.test/<chain>. The figures here deliberately differ from the mocked
 * contract reads (12,345 SAFE staked against the RPC mock's 10,000), so a test can tell which
 * source a number on screen came from.
 */
import type { Route } from "@playwright/test"
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
          activeValidators: 2,
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
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY
  // Sixteen days back to today: the first indexed day and today are partial, 14 count.
  const dates = Array.from({ length: 17 }, (_, i) => today - (16 - i) * DAY)
  const buckets = Array.from({ length: 65 }, (_, i) => (i === SUBGRAPH_FIGURES.latencyMedianBlocks ? "100" : "0"))
  return {
    _meta: meta(SUBGRAPH_FIGURES.gnosisBlock, mode),
    firstDay: [{ date: dates[0] }],
    consensusDays: dates.map((date) => ({
      date,
      attestations: String(SUBGRAPH_FIGURES.attestationsPerDay),
      attestationCeremonies: "1000",
      latencyBuckets: buckets,
    })),
    validatorDays: dates.flatMap((date) => [
      { date, attended: "1000", validator: { id: VALIDATORS.validatorA } },
      { date, attended: "990", validator: { id: VALIDATORS.validatorB } },
    ]),
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
