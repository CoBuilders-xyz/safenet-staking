import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { AEGIS_START_DAY, BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import type { ParticipationPoint, ValidatorSeries } from "@/lib/participationSeries"
import { ParticipationHistory } from "../validators/ParticipationHistory"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

const { mockSeries } = vi.hoisted(() => ({ mockSeries: vi.fn() }))
vi.mock("@/hooks/useValidatorParticipation", () => ({ useValidatorParticipation: () => ({ series: mockSeries() }) }))
// Recharts needs a laid-out DOM; the plot is checked in the browser. The stub shows what it was given.
vi.mock("../validators/TimeSeriesChart", () => ({
  default: (p: { series: { label: string }[]; data: unknown[] }) => (
    <div data-testid="chart">
      {p.series.map((s) => s.label).join(",")}:{p.data.length}
    </div>
  ),
}))

const DAY = 86_400
const HOUR = 3_600
const end = utcDayMs(BETA_END_DAY) / 1000
const aegis = utcDayMs(AEGIS_START_DAY) / 1000

const point = (start: number, attended: number, ceremonies = 1000): ParticipationPoint => ({
  programme: start >= aegis ? "aegis" : "beta",
  start,
  attended,
  ceremonies,
  rate: attended / ceremonies,
})

const beta: ValidatorSeries = {
  daily: Array.from({ length: 16 }, (_, i) => point(end - (15 - i) * DAY, i === 15 ? 998 : 1000)),
  hourly: Array.from({ length: 24 * 8 }, (_, i) => point(end + 23 * HOUR - (24 * 8 - 1 - i) * HOUR, 40, 40)),
}

function renderSection(series: Figure<ValidatorSeries>) {
  mockSeries.mockReturnValue(series)
  return render(
    <TooltipProvider>
      <ParticipationHistory address={TEST_ACCOUNTS.validator1} />
    </TooltipProvider>,
  )
}

describe("ParticipationHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows Beta's last 30 days by default, labelled Beta, under the dated notice and never as current", async () => {
    renderSection(ready(beta, "subgraph"))

    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText(/^Beta, 20 Sep 2026 to 5 Oct 2026\. Gnosis subgraph:/)).toHaveTextContent(
      "per complete UTC bucket.",
    )
    expect(screen.getByRole("note", { name: "Beta ended" })).toHaveTextContent("Beta has ended. These are historical figures.")
    expect(screen.getByText("2 of 16,000 ceremonies missed", { exact: true })).toBeInTheDocument()
    // Floored beside a missed count, so it never reads 100.00%.
    expect(screen.getByText("99.98%")).toBeInTheDocument()
    expect(await screen.findByTestId("chart")).toHaveTextContent("Beta:16")
    expect(screen.getByRole("img", { name: /^Beta, 20 Sep 2026 to 5 Oct 2026: 99\.98% attendance/ })).toBeInTheDocument()
  })

  it("switches to 7 days of hourly buckets, and lists every value in the table", async () => {
    renderSection(ready(beta, "subgraph"))
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))

    expect(await screen.findByTestId("chart")).toHaveTextContent("Beta:168")
    expect(screen.getByText(/per complete UTC bucket/)).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(within(table).getAllByRole("row")).toHaveLength(169)
    expect(within(table).getByText("Mon 5 Oct 2026, 23:00 UTC")).toBeInTheDocument()
  })

  it("draws one labelled series per programme when the window holds both, with no Beta notice", async () => {
    const mixed: ValidatorSeries = { hourly: [], daily: [point(end - DAY, 990), point(end, 1000), point(aegis, 500), point(aegis + DAY, 750)] }
    renderSection(ready(mixed, "subgraph"))

    expect(await screen.findByTestId("chart")).toHaveTextContent("Beta,Aegis:4")
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("BetaAegis")
    expect(screen.queryByRole("note", { name: "Beta ended" })).not.toBeInTheDocument()
    expect(screen.getByText(/^Beta \/ Aegis, 4 Oct 2026 to 14 Oct 2026\. Gnosis subgraph/)).toBeInTheDocument()
  })

  it("says the subgraph holds nothing for the validator", () => {
    renderSection(ready({ hourly: [], daily: [] }, "subgraph"))
    expect(screen.getByText("No complete participation history is available for this validator and window.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    expect(screen.getByText("No complete participation history is available for this validator and window.")).toBeInTheDocument()
  })

  it("says why the figures are unavailable, and shows a skeleton while loading", () => {
    const { unmount } = renderSection(unavailable("The subgraph could not be queried."))
    expect(screen.getByText("Unavailable. The subgraph could not be queried.")).toBeInTheDocument()
    unmount()
    renderSection(loading())
    expect(screen.getByLabelText("Loading")).toBeInTheDocument()
  })
})
