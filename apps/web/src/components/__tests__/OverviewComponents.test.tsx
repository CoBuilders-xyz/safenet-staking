import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import type { ReactNode } from "react"
import { getAddress } from "viem"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { Stat } from "../overview/Stat"
import { Distribution } from "../overview/Distribution"
import { Validators } from "../overview/Validators"
import { ChainFreshness } from "../overview/Freshness"
import { SectionBoundary } from "../overview/OverviewSection"
import { ParticipationRate } from "../validators/ParticipationRate"
import { PARTICIPATION_RULE } from "@/lib/programme"
import { HHI_DEFINITION } from "@/lib/distribution"

const SAFE = 10n ** 18n
const A = getAddress(TEST_ACCOUNTS.validator1)
const B = getAddress(TEST_ACCOUNTS.validator2)

describe("Stat", () => {
  it("shows the value and names its source", () => {
    render(<Stat label="Total SAFE staked" figure={{ state: "ready", value: 1234, source: "subgraph" }} format={(v) => v.toLocaleString("en-US")} source={(s) => `from ${s}`} />)
    const stat = screen.getByRole("group", { name: "Total SAFE staked" })
    expect(within(stat).getByText("1,234")).toBeInTheDocument()
    expect(within(stat).getByText("from subgraph")).toBeInTheDocument()
  })

  it("shows Unavailable and the reason, never a number", () => {
    render(<Stat label="Stakers" figure={{ state: "unavailable", reason: "No contract read gives this figure." }} format={String} />)
    const stat = screen.getByRole("group", { name: "Stakers" })
    expect(within(stat).getByText("Unavailable")).toBeInTheDocument()
    expect(within(stat).getByText("No contract read gives this figure.")).toBeInTheDocument()
  })

  it("shows a skeleton while loading", () => {
    render(<Stat label="Stakers" figure={{ state: "loading" }} format={String} />)
    expect(screen.getByLabelText("Loading Stakers")).toBeInTheDocument()
  })
})

describe("Distribution", () => {
  const rows = [
    { address: A, label: "Gnosis", share: 0.6 },
    { address: B, label: undefined, share: 0.4 },
  ]

  it("shows the index, its one-line definition, and every share", () => {
    render(<Distribution rows={rows} index={5200} />)
    expect(screen.getByText("HHI 5,200")).toBeInTheDocument()
    expect(screen.getByText(HHI_DEFINITION)).toBeInTheDocument()
    expect(screen.getByText("60.0%")).toBeInTheDocument()
    expect(screen.getByText("40.0%")).toBeInTheDocument()
  })

  it("labels an unlisted validator by its address", () => {
    render(<Distribution rows={rows} index={5200} />)
    expect(screen.getByText(B.toLowerCase().slice(0, 6) + "..." + B.toLowerCase().slice(-4))).toBeInTheDocument()
  })

  it("keeps a validator's colour when its rank changes", () => {
    const colourOf = (name: string) => (screen.getByText(name).previousElementSibling as HTMLElement).style.background
    const { unmount } = render(<Distribution rows={[{ address: A, label: "One", share: 0.6 }, { address: B, label: "Two", share: 0.4 }]} index={1} />)
    const before = colourOf("One")
    unmount()
    render(<Distribution rows={[{ address: B, label: "Two", share: 0.7 }, { address: A, label: "One", share: 0.3 }]} index={1} />)
    expect(colourOf("One")).toBe(before)
  })
})

const withRouter = (ui: ReactNode) => (
  <MemoryRouter>
    <TooltipProvider>{ui}</TooltipProvider>
  </MemoryRouter>
)

describe("ParticipationRate", () => {
  it("marks a rate at or above the threshold, with SEF's rule in its tooltip", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ParticipationRate rate={0.75} />
      </TooltipProvider>,
    )
    expect(screen.getByText("75.00%")).not.toHaveClass("text-warning")
    const marker = screen.getByRole("button", { name: "At or above the 75% reward threshold" })
    expect(marker).toHaveTextContent("≥75%")
    await userEvent.hover(marker)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(PARTICIPATION_RULE)
  })

  it("marks a rate below the threshold in words, not colour alone", () => {
    render(withRouter(<ParticipationRate rate={0.7449} text="74.49%" />))
    expect(screen.getByText("74.49%")).toHaveClass("text-warning")
    expect(screen.getByRole("button", { name: "Below the 75% reward threshold" })).toHaveTextContent("<75%")
  })

  it("states the rule in SEF's words", () => {
    expect(PARTICIPATION_RULE).toBe(
      "If a validator's participation is below 75% in a reward period, both the validator and its delegators earn no rewards for that period.",
    )
  })
})

describe("Validators", () => {
  const row = {
    address: A,
    label: "Gnosis",
    stake: 1500n * SAFE,
    share: 0.75,
    stakers: 12,
    participation: 0.9876,
    absences: 31n,
    status: "active" as const,
  }

  it("shows stake, share, stakers, participation and missed ceremonies, and links to the detail page", () => {
    render(withRouter(<Validators rows={[row]} />))
    expect(screen.getByRole("link", { name: "Gnosis" })).toHaveAttribute("href", `/validators/${A}`)
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText("75.0%")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("98.76%")).toBeInTheDocument()
    expect(screen.getByText("31 missed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "At or above the 75% reward threshold" })).toBeInTheDocument()
  })

  it("offers to stake with an active validator", () => {
    render(withRouter(<Validators rows={[row]} />))
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Stake with Gnosis" })).toHaveAttribute("href", `/validators?delegate=${A}`)
  })

  it("keeps a withdrawn validator's stake and participation, says so, and offers no stake action", () => {
    render(withRouter(<Validators rows={[{ ...row, address: B, label: "Blockchain Capital", status: "withdrawn" }]} />))
    const tr = screen.getByRole("link", { name: "Blockchain Capital" }).closest("tr")!
    expect(tr).toHaveTextContent("Withdrawn, Aegis participation unconfirmed")
    expect(tr).toHaveTextContent("1,500")
    expect(tr).toHaveTextContent("98.76%")
    expect(tr).toHaveTextContent("31 missed")
    expect(within(tr).queryByRole("link", { name: /^Stake/ })).not.toBeInTheDocument()
  })

  it("marks a participation below the threshold and keeps the missed count beside it", () => {
    render(withRouter(<Validators rows={[{ ...row, participation: 0.7, absences: 300n }]} />))
    expect(screen.getByText("70.00%")).toHaveClass("text-warning")
    expect(screen.getByRole("button", { name: "Below the 75% reward threshold" })).toBeInTheDocument()
    expect(screen.getByText("300 missed")).toBeInTheDocument()
  })

  it("says when SEF's list does not carry a validator, and nothing before it loads", () => {
    const { unmount } = render(withRouter(<Validators rows={[{ ...row, status: "unlisted" }]} />))
    expect(screen.getByText("Not in SEF's list")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /^Stake/ })).not.toBeInTheDocument()
    unmount()
    render(withRouter(<Validators rows={[{ ...row, status: undefined }]} />))
    expect(screen.queryByText("Not in SEF's list")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /^Stake/ })).not.toBeInTheDocument()
  })

  it("never shows 100.00% beside a missed count", () => {
    const rate = Number((59_190n * 1_000_000_000n) / 59_192n) / 1_000_000_000
    render(withRouter(<Validators rows={[{ ...row, participation: rate, absences: 2n }]} />))
    expect(screen.getByText("99.99%")).toBeInTheDocument()
    expect(screen.getByText("2 missed")).toBeInTheDocument()
  })

  it("drops the stakers column when no row has it, and says when participation is missing", () => {
    render(withRouter(<Validators rows={[{ ...row, stakers: undefined, participation: undefined, absences: undefined }]} />))
    expect(screen.queryByRole("columnheader", { name: "Stakers" })).not.toBeInTheDocument()
    expect(screen.getByText("Not available")).toBeInTheDocument()
  })
})

describe("ChainFreshness", () => {
  const freshness = { block: 25_700_259, blockTimestamp: 0, ageSeconds: 18, checkedAt: Date.UTC(2026, 9, 4, 14, 3), hasIndexingErrors: false }

  it("shows the last indexed block and its age when live", () => {
    render(<ChainFreshness chain="Mainnet" result={{ status: "live", data: {}, freshness }} fallback="unused" />)
    expect(screen.getByText(/live\. Last indexed block/)).toHaveTextContent(
      "Mainnet subgraph: live. Last indexed block 25,700,259, 18 s old when checked at Sun 4 Oct 2026, 14:03 UTC.",
    )
  })

  it("says why the subgraph is not used and what is shown instead", () => {
    render(
      <ChainFreshness
        chain="Mainnet"
        result={{ status: "degraded", degradation: { kind: "failed", message: "x" } }}
        fallback="Figures are read from the contracts instead."
      />,
    )
    expect(screen.getByText(/not used/)).toHaveTextContent(
      "Mainnet subgraph: not used. The subgraph could not be queried. Figures are read from the contracts instead.",
    )
  })
})

describe("SectionBoundary", () => {
  it("keeps a section's failure inside the section", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    function Broken(): never {
      throw new Error("boom")
    }
    render(
      <>
        <SectionBoundary title="Rewards">
          <Broken />
        </SectionBoundary>
        <p>Still here</p>
      </>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("This section could not be shown.")
    expect(screen.getByRole("region", { name: "Rewards" })).toBeInTheDocument()
    expect(screen.getByText("Still here")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })
})
