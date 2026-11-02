import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RewardHistorySection } from "../rewards/RewardHistorySection"
import { TEST_ACCOUNTS, MOCK_TX_HASH } from "@/__tests__/test-data"
import { meta } from "@/__tests__/subgraph-mocks"
import { readFreshness } from "@/lib/subgraph"
import type { RewardHistoryState } from "@/hooks/useRewardHistory"
import { i18n } from "@/i18n"
import { LANGUAGES } from "@/i18n/languages"

const mock = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }))
vi.mock("@/hooks/useRewardHistory", () => ({ useRewardHistory: () => mock.read() }))
function show(state: RewardHistoryState) {
  mock.read.mockReturnValue({ state, address: state.status === "disconnected" ? undefined : TEST_ACCOUNTS.user, refetch: mock.retry })
  return render(<RewardHistorySection />)
}
const ready: RewardHistoryState = {
  status: "ready",
  data: {
    freshness: readFreshness(meta(), Date.now()), totalPeriods: 20,
    rows: [{ period: 20, startBlock: 100n, endBlock: 200n, timestamp: 1, transaction: MOCK_TX_HASH, claims: 1, claimed: 1n }],
  },
}

beforeEach(() => { vi.clearAllMocks() })

describe("RewardHistorySection", () => {
  it("explains bounded claim semantics before a wallet connects", () => {
    show({ status: "disconnected" })
    expect(screen.getByText(/Connect a wallet/)).toBeVisible()
    expect(screen.getByText(/Latest 12 distributions only, up to 999 claims/)).toBeVisible()
    expect(screen.getByText(/not rewards earned/)).toBeVisible()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })
  it("announces loading", () => {
    show({ status: "loading" })
    expect(screen.getByRole("status", { name: "Loading" })).toBeVisible()
  })
  it.each(["incomplete", "unavailable", "stale"] as const)("announces %s without a numeric table and allows retry", async (status) => {
    show({ status })
    expect(screen.getByRole("alert")).toBeVisible()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(mock.retry).toHaveBeenCalledOnce()
  })
  it("renders an accessible table, exact small amounts, address, range and distribution links", () => {
    show(ready)
    expect(screen.getByText(TEST_ACCOUNTS.user)).toBeVisible()
    expect(screen.getByText(/Showing distributions 20–20 of 20/)).toBeVisible()
    const table = screen.getByRole("table")
    expect(within(table).getByText("0.000000000000000001")).toBeVisible()
    expect(within(table).getByRole("link", { name: "Distribution 20 transaction" })).toHaveAttribute("href", expect.stringContaining(MOCK_TX_HASH))
    expect(table.parentElement).toHaveAttribute("tabindex", "0")
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5)
  })
  it.each(LANGUAGES.map((l) => l.code))("renders limits, caveats and headers in %s", async (language) => {
    await i18n.changeLanguage(language)
    show(ready)
    expect(screen.getByRole("table", { name: i18n.t("rewardHistory.title") })).toBeVisible()
    expect(screen.getByText(i18n.t("rewardHistory.limits", { periods: 12, claims: 999 }))).toBeVisible()
    expect(screen.getByText(i18n.t("rewardHistory.order"))).toBeVisible()
    if (language !== "en") expect(screen.queryByText("Your claims by distribution period")).not.toBeInTheDocument()
  })
})
