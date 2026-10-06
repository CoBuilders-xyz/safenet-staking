import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { getAddress } from "viem"
import { GNOSIS_SNAPSHOT } from "@cobuilders/safenet-core"
import { MOCK_VALIDATORS, TEST_ACCOUNTS } from "@/__tests__/test-data"
import type { SubgraphResult } from "@/hooks/useSubgraphQuery"
import { OverviewPage } from "../OverviewPage"

const SAFE = 10n ** 18n
const A = getAddress(TEST_ACCOUNTS.validator1)
const B = getAddress(TEST_ACCOUNTS.validator2)
const FRESH = { block: 25_900_000, blockTimestamp: 0, ageSeconds: 24, checkedAt: Date.UTC(2026, 9, 4, 12), hasIndexingErrors: false }
const LIVE: SubgraphResult<unknown> = { status: "live", data: {}, freshness: FRESH }
const FAILED: SubgraphResult<unknown> = { status: "degraded", degradation: { kind: "failed", message: "down" } }

const mocks = vi.hoisted(() => ({
  network: vi.fn(),
  networkQuery: vi.fn(),
  stakes: vi.fn(),
  rewards: vi.fn(),
  days: vi.fn(),
  consensus: vi.fn(),
}))
vi.mock("@/hooks/useNetworkTotals", () => ({ useNetworkTotals: () => mocks.network(), useNetworkQuery: () => mocks.networkQuery() }))
vi.mock("@/hooks/useValidatorStakes", () => ({ useValidatorStakes: () => mocks.stakes() }))
vi.mock("@/hooks/useRewardsOverview", () => ({ useRewardsOverview: () => mocks.rewards() }))
vi.mock("@/hooks/useRecentDays", () => ({ RECENT_DAYS: 30, useRecentDays: () => mocks.days() }))
vi.mock("@/hooks/useConsensusFigures", () => ({ useConsensusFigures: () => mocks.consensus() }))
vi.mock("@/hooks/useValidators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useValidators")>()),
  useValidators: () => ({ data: MOCK_VALIDATORS, error: null }),
}))

const ready = <T,>(value: T, source: string) => ({ state: "ready" as const, value, source })

function live() {
  mocks.networkQuery.mockReturnValue(LIVE)
  mocks.network.mockReturnValue({
    subgraph: LIVE,
    totalStaked: ready(73_000_000n * SAFE, "subgraph"),
    activeValidators: ready(6, "subgraph"),
    stakers: ready(884, "subgraph"),
  })
  mocks.stakes.mockReturnValue({
    subgraph: LIVE,
    rows: ready(
      [
        { address: A, label: "Gnosis", stake: 600n * SAFE, share: 0.6, stakers: 10 },
        { address: B, label: "Greenfield", stake: 400n * SAFE, share: 0.4, stakers: 4 },
      ],
      "subgraph",
    ),
  })
  mocks.rewards.mockReturnValue({
    allocated: ready(1000n * SAFE, "sef"),
    claimed: ready(700n * SAFE, "subgraph"),
    unclaimed: ready(300n * SAFE, "subgraph"),
    rootMatches: true,
  })
  mocks.days.mockReturnValue({
    subgraph: LIVE,
    activity: ready({ since: 1_788_480_000, days: [], stakedIn: 5n * SAFE, withdrawnOut: 2n * SAFE, rewardsClaimed: 1n * SAFE, stakes: 7, withdrawals: 1 }, "subgraph"),
  })
  mocks.consensus.mockReturnValue({
    subgraph: LIVE,
    window: { days: 14, from: 1_788_480_000, to: 1_789_603_200 },
    attestations: ready({ mean: 4600, min: 3000, max: 6000, days: 14 }, "subgraph"),
    latency: ready({ medianBlocks: 4, seconds: 20 }, "subgraph"),
    participation: new Map([[A.toLowerCase(), { rate: 0.995, attended: 199n, absences: 1n }]]),
    snapshot: GNOSIS_SNAPSHOT,
    snapshotReason: undefined,
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  )
}

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    live()
  })

  it("renders every section from the subgraphs, with freshness", () => {
    renderPage()
    expect(screen.getByRole("heading", { name: "Network overview" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open the staking dashboard" })).toHaveAttribute("href", "/dashboard")
    expect(screen.getByRole("status", { name: "Data freshness" })).toHaveTextContent("Mainnet subgraph: live. Last indexed block 25,900,000")

    expect(within(screen.getByRole("group", { name: "Total SAFE staked" })).getByText("73,000,000")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Active validators" })).getByText("6")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Attestations per day" })).getByText("4,600")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Attestation latency" })).getByText("~20 s")).toBeInTheDocument()

    const distribution = screen.getByRole("region", { name: "Stake distribution" })
    expect(within(distribution).getByText("HHI 5,200")).toBeInTheDocument()

    const rewards = screen.getByRole("region", { name: "Rewards" })
    expect(within(rewards).getByText("700 SAFE")).toBeInTheDocument()
    expect(within(rewards).getByText("300 SAFE")).toBeInTheDocument()
    expect(within(rewards).getByText("Match")).toBeInTheDocument()

    const validators = screen.getByRole("region", { name: "Validators" })
    expect(within(validators).getByText("99.50%")).toBeInTheDocument()
    expect(within(validators).getByText("1 missed")).toBeInTheDocument()
    // Greenfield has no subgraph participation, so SEF's published figure is shown.
    expect(within(validators).getByText("99.70%")).toBeInTheDocument()

    expect(within(screen.getByRole("region", { name: "Last 30 days" })).getByText("884")).toBeInTheDocument()
  })

  it("names the source each section actually used", () => {
    renderPage()
    const rewards = screen.getByRole("region", { name: "Rewards" })
    expect(rewards).toHaveTextContent("Claimed: the Mainnet subgraph's sum of Claimed events")
    expect(rewards).not.toHaveTextContent("MerkleDrop's live SAFE balance")
    // 700 of 1,000: the two labels always add up to 100.0.
    expect(rewards).toHaveTextContent("70.0% claimed")
    expect(rewards).toHaveTextContent("30.0% unclaimed")

    // Gnosis has a row for Gnosis only: Greenfield falls back to SEF's figure and is marked.
    const validators = screen.getByRole("region", { name: "Validators" })
    expect(validators).toHaveTextContent('rows marked "SEF file" use SEF\'s published 14-day figure')
    expect(within(validators).getAllByText("SEF file")).toHaveLength(1)
  })

  it("names the MerkleDrop balance when claims come from the contract", () => {
    mocks.rewards.mockReturnValue({
      allocated: ready(1000n * SAFE, "sef"),
      claimed: ready(333n * SAFE, "contract"),
      unclaimed: ready(667n * SAFE, "contract"),
      rootMatches: true,
    })
    renderPage()
    const rewards = screen.getByRole("region", { name: "Rewards" })
    expect(rewards).toHaveTextContent("Claimed and unclaimed: allocated minus the MerkleDrop's live SAFE balance.")
    expect(rewards).not.toHaveTextContent("sum of Claimed events")
    expect(rewards).toHaveTextContent("33.3% claimed")
    expect(rewards).toHaveTextContent("66.7% unclaimed")
  })

  it("shows why snapshot figures are shown while the Gnosis subgraph is live", () => {
    mocks.consensus.mockReturnValue({
      subgraph: LIVE,
      window: undefined,
      attestations: ready({ mean: 4510, min: 3093, max: 5908, days: 14 }, "snapshot"),
      latency: ready({ medianBlocks: 5, seconds: 25 }, "snapshot"),
      participation: undefined,
      snapshot: GNOSIS_SNAPSHOT,
      snapshotReason: "The Gnosis subgraph has not indexed a complete UTC day yet.",
    })
    renderPage()
    for (const name of ["Attestations per day", "Attestation latency"]) {
      expect(screen.getByRole("group", { name })).toHaveTextContent(
        "Snapshot measured Tue 29 Sep 2026, 14:41 UTC. The Gnosis subgraph has not indexed a complete UTC day yet.",
      )
    }
    expect(screen.getByRole("region", { name: "Validators" })).toHaveTextContent("Participation: SEF's published 14-day figure.")
  })

  it("shows no APY and no SAFE price", () => {
    renderPage()
    expect(screen.queryByText(/APY|APR|price/i)).not.toBeInTheDocument()
  })

  it("says, in a plain sentence, when figures come from the contracts and the snapshot", () => {
    mocks.networkQuery.mockReturnValue(FAILED)
    mocks.network.mockReturnValue({
      subgraph: FAILED,
      totalStaked: ready(70_000_000n * SAFE, "contract"),
      activeValidators: ready(6, "sef"),
      stakers: { state: "unavailable", reason: "The subgraph could not be queried. No contract read gives this figure." },
    })
    mocks.consensus.mockReturnValue({
      subgraph: FAILED,
      window: undefined,
      attestations: ready({ mean: 4510, min: 3093, max: 5908, days: 14 }, "snapshot"),
      latency: ready({ medianBlocks: 5, seconds: 25 }, "snapshot"),
      participation: undefined,
      snapshot: GNOSIS_SNAPSHOT,
      snapshotReason: "The subgraph could not be queried.",
    })
    mocks.days.mockReturnValue({ subgraph: FAILED, activity: { state: "unavailable", reason: "No contract read gives a daily history." } })
    renderPage()

    const freshness = screen.getByRole("status", { name: "Data freshness" })
    expect(freshness).toHaveTextContent("read directly from the contracts on Ethereum instead")
    expect(freshness).toHaveTextContent("snapshot measured Tue 29 Sep 2026, 14:41 UTC")
    expect(within(screen.getByRole("group", { name: "Total SAFE staked" })).getByText("Read directly from the contracts on Ethereum")).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Attestations per day" })).toHaveTextContent(
      "Snapshot measured Tue 29 Sep 2026, 14:41 UTC. The subgraph could not be queried.",
    )
    expect(within(screen.getByRole("region", { name: "Last 30 days" })).getByText(/Unavailable\. No contract read/)).toBeInTheDocument()
  })

  it("keeps the page up when one section throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.rewards.mockImplementation(() => {
      throw new Error("boom")
    })
    renderPage()
    expect(within(screen.getByRole("region", { name: "Rewards" })).getByRole("alert")).toHaveTextContent("This section could not be shown.")
    expect(screen.getByRole("region", { name: "Validators" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Total SAFE staked" })).toBeInTheDocument()
  })
})
