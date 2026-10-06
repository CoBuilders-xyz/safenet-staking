import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { getAddress } from "viem"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { Stat } from "../overview/Stat"
import { Distribution } from "../overview/Distribution"
import { Validators } from "../overview/Validators"
import { ChainFreshness } from "../overview/Freshness"
import { SectionBoundary } from "../overview/OverviewSection"
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

describe("Validators", () => {
  const row = { address: A, label: "Gnosis", stake: 1500n * SAFE, share: 0.75, stakers: 12, participation: 0.9876, absences: 31n }

  it("shows stake, share, stakers, participation and missed ceremonies, and links to the detail page", () => {
    render(<MemoryRouter><Validators rows={[row]} /></MemoryRouter>)
    expect(screen.getByRole("link", { name: "Gnosis" })).toHaveAttribute("href", `/validators/${A}`)
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText("75.0%")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("98.76%")).toBeInTheDocument()
    expect(screen.getByText("31 missed")).toBeInTheDocument()
  })

  it("drops the stakers column when no row has it, and says when participation is missing", () => {
    render(<MemoryRouter><Validators rows={[{ ...row, stakers: undefined, participation: undefined, absences: undefined }]} /></MemoryRouter>)
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
