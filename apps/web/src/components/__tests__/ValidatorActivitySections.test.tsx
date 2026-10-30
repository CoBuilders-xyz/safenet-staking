import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import type { ValidatorActivity } from "@/hooks/useValidatorActivity"
import { buildHistory, delegatorSeries, type StakeRow, type ValidatorRow, type WithdrawalRow } from "@/lib/validatorActivity"
import { explorerTxUrl, explorerBlockUrl, explorerAddressUrl } from "@/lib/explorer"
import { ValidatorActivitySections } from "../validators/ValidatorActivitySections"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

const { mockActivity } = vi.hoisted(() => ({ mockActivity: vi.fn() }))
vi.mock("@/hooks/useValidatorActivity", () => ({ useValidatorActivity: () => ({ activity: mockActivity() }) }))
vi.mock("../validators/TimeSeriesChart", () => ({
  default: (p: { data: unknown[] }) => <div data-testid="chart">{p.data.length}</div>,
}))

const SAFE = 10n ** 18n
const T0 = 1_774_569_600
const hex = (n: number, len: number) => `0x${n.toString(16).padStart(len, "0")}`

const stakes: StakeRow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `${hex(i + 1, 64)}-${i}`,
  staker: hex(i % 3, 40),
  amount: (10n * SAFE).toString(),
  blockNumber: String(24_800_000 + i),
  timestamp: String(T0 + i * 86_400),
  transactionHash: hex(i + 1, 64),
}))
const withdrawals: WithdrawalRow[] = [
  {
    id: "7",
    staker: hex(2, 40),
    amount: (30n * SAFE).toString(),
    claimed: true,
    initiatedAtBlock: "24900000",
    initiatedAtTimestamp: String(T0 + 40 * 86_400),
    initiatedTxHash: hex(900, 64),
    claimedAtBlock: "24950000",
    claimedAtTimestamp: String(T0 + 47 * 86_400),
    claimedTxHash: hex(901, 64),
  },
]
const validator: ValidatorRow = {
  id: TEST_ACCOUNTS.validator1.toLowerCase(),
  isRegistered: true,
  totalStaked: "0",
  stakersCurrent: 3,
  stakersEver: 3,
  registeredAtBlock: "24741826",
  registeredAtTimestamp: "1774529219",
}

function activity(v: ValidatorRow | null = validator, matches = true): Figure<ValidatorActivity> {
  return ready(
    {
      validator: v,
      history: buildHistory(v, v ? stakes : [], v ? withdrawals : []),
      delegators: delegatorSeries(stakes, withdrawals),
      replayMatches: matches,
      block: 26_287_212,
      indexedAt: T0 + 60 * 86_400,
    },
    "subgraph",
  )
}

function renderSections(figure: Figure<ValidatorActivity>) {
  mockActivity.mockReturnValue(figure)
  return render(<ValidatorActivitySections address={validator.id} />)
}

describe("ValidatorActivitySections", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows delegators now and ever, the registration with its block, and the series over time", async () => {
    renderSections(activity())
    const section = screen.getByRole("region", { name: "Delegators and registration" })

    expect(within(section).getByText("Delegators now").nextSibling).toHaveTextContent("3")
    expect(within(section).getByText("3 have ever staked")).toBeInTheDocument()
    expect(within(section).getByText("26 March 2026")).toBeInTheDocument()
    expect(within(section).getByRole("link", { name: /^24,741,826\s*Block on / })).toHaveAttribute("href", explorerBlockUrl(24_741_826n))
    expect(within(section).getByText("Registered", { selector: "dd" })).toBeInTheDocument()
    // One point per day with an event, and one more carrying the count to the indexed day.
    expect(await within(section).findByTestId("chart")).toHaveTextContent("32")
    expect(within(section).getByText(/Mainnet subgraph, block 26,287,212/)).toBeInTheDocument()
  })

  it("says a deregistered validator is not registered, without inventing a date", () => {
    renderSections(activity({ ...validator, isRegistered: false }))
    expect(screen.getByText("Not registered")).toBeInTheDocument()
    expect(screen.getByText(/The subgraph reports no current registration/)).toBeInTheDocument()
  })

  it("hides the series and event history when replay disagrees with the subgraph's own count", () => {
    renderSections(activity({ ...validator, stakersCurrent: 5 }, false))
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument()
    expect(screen.getAllByText("History is unavailable: replayed totals differ from the subgraph counters.")).toHaveLength(2)
    const history = within(screen.getByRole("region", { name: "Event history" }))
    expect(history.queryByRole("table")).not.toBeInTheDocument()
    expect(history.queryByRole("button", { name: /Show .* more/ })).not.toBeInTheDocument()
    expect(history.queryByText("No event is indexed for this validator.")).not.toBeInTheDocument()
  })

  it("lists the history newest first with explorer links, 25 at a time", () => {
    renderSections(activity())
    const history = screen.getByRole("region", { name: "Event history" })
    const rows = within(history).getAllByRole("row").slice(1)

    expect(rows).toHaveLength(25)
    expect(rows[0]).toHaveTextContent("Withdrawal claimed")
    expect(within(rows[0]).getByRole("link", { name: /^0x\S+?\s*Transaction on / })).toHaveAttribute("href", explorerTxUrl(hex(901, 64)))
    expect(within(rows[1]).getByText("Unstake started")).toBeInTheDocument()
    expect(within(rows[1]).getByRole("link", { name: /^0x\S+?\s*Delegator on / })).toHaveAttribute("href", explorerAddressUrl(hex(2, 40)))
    expect(rows[1]).toHaveTextContent("30")
    expect(within(history).getByText("25 of 33 events, newest first")).toBeInTheDocument()

    fireEvent.click(within(history).getByRole("button", { name: "Show 8 more" }))
    const all = within(history).getAllByRole("row").slice(1)
    expect(all).toHaveLength(33)
    expect(all[32]).toHaveTextContent("Registered")
    expect(within(all[32]).getByRole("link", { name: /^Block 24,741,826\s*on / })).toBeInTheDocument()
    expect(within(history).queryByRole("button", { name: /Show .* more/ })).not.toBeInTheDocument()
  })

  it("says when the subgraph has no record of the address", () => {
    renderSections(activity(null, false))
    expect(screen.getAllByText("The Mainnet subgraph has no record of this validator.")).toHaveLength(2)
  })

  it("says why both sections are unavailable, and shows skeletons while loading", () => {
    const { unmount } = renderSections(unavailable("The subgraph could not be queried."))
    expect(screen.getAllByText("Unavailable. The subgraph could not be queried.")).toHaveLength(2)
    unmount()
    renderSections(loading())
    expect(screen.getAllByLabelText("Loading")).toHaveLength(2)
  })
})
