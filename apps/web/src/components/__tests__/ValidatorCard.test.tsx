import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { ValidatorCard } from "../validators/ValidatorCard"
import { TEST_ACCOUNTS, MOCK_VALIDATORS } from "@/__tests__/test-data"

const mockUseAccount = vi.fn()

vi.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
}))

vi.mock("@/hooks/useValidators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useValidators")>()
  return { ...actual }
})

vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}))

// Mock DelegateDialog and UndelegateDialog to prevent deep hook chain
vi.mock("@/components/staking/DelegateDialog", () => ({
  DelegateDialog: () => null,
}))

vi.mock("@/components/staking/UndelegateDialog", () => ({
  UndelegateDialog: () => null,
}))

describe("ValidatorCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAccount.mockReturnValue({ isConnected: true })
  })

  function renderCard(props = {}) {
    return render(
      <MemoryRouter>
        <TooltipProvider>
          <ValidatorCard
            validator={TEST_ACCOUNTS.validator1}
            isActive={true}
            totalStake={5000n * 10n ** 18n}
            userStake={100n * 10n ** 18n}
            validators={[...MOCK_VALIDATORS]}
            {...props}
          />
        </TooltipProvider>
      </MemoryRouter>,
    )
  }

  it("renders validator label and metadata", () => {
    renderCard()

    expect(screen.getByText("Gnosis")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Commission" })).toBeInTheDocument()
    expect(screen.getByText("5%")).toBeInTheDocument()
    expect(screen.getByText("Participation (14d):")).toBeInTheDocument()
    expect(screen.getByText("99.9%")).toBeInTheDocument()
  })

  it("shows Active badge for active validator", () => {
    renderCard()

    expect(screen.getByText("Active")).toBeInTheDocument()
  })

  it("shows a Withdrawn badge for a validator SEF marks inactive", () => {
    renderCard({ isActive: false })

    expect(screen.getByText("Withdrawn")).toBeInTheDocument()
  })

  it("shows the 75% reward threshold beside the participation rate", () => {
    renderCard()

    expect(screen.getByRole("button", { name: "At or above the 75% reward threshold" })).toBeInTheDocument()
  })

  it("marks a participation rate below the threshold", () => {
    renderCard({ validators: [{ ...MOCK_VALIDATORS[0], participationRate: 72.5 }] })

    expect(screen.getByText("72.5%")).toHaveClass("text-warning")
    expect(screen.getByRole("button", { name: "Below the 75% reward threshold" })).toBeInTheDocument()
  })

  it("says Not published, with no threshold marker, when SEF publishes no rate", () => {
    renderCard({ validators: [{ ...MOCK_VALIDATORS[0], participationRate: null }] })

    expect(screen.getByText("Not published")).toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /reward threshold/ })).not.toBeInTheDocument()
  })

  it("shows Stake and Unstake buttons when connected", () => {
    renderCard()

    expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unstake" })).toBeInTheDocument()
  })

  it("hides action buttons when disconnected", () => {
    mockUseAccount.mockReturnValue({ isConnected: false })
    renderCard()

    expect(screen.queryByRole("button", { name: "Stake" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Unstake" })).not.toBeInTheDocument()
  })

  it("disables Stake button for inactive validator", () => {
    renderCard({ isActive: false })

    expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled()
  })

  it("shows total and user stake amounts", () => {
    renderCard()

    expect(screen.getByText("Total SAFE Staked")).toBeInTheDocument()
    expect(screen.getByText("Your Stake")).toBeInTheDocument()
  })

  it("shows delegators, the registration day and the misses with their window", () => {
    renderCard({ delegators: 446, registeredAt: 1_774_529_219, missed: 1_252n, missedLabel: "Missed, Beta's last 14 days" })

    expect(screen.getByText("446")).toBeInTheDocument()
    expect(screen.getByText("26 Mar 2026")).toBeInTheDocument()
    expect(screen.getByText("Missed, Beta's last 14 days")).toBeInTheDocument()
    expect(screen.getByText("1,252")).toBeInTheDocument()
  })

  it("labels the fallback as first seen, without claiming registration", () => {
    renderCard({ firstSeenAt: 1_774_528_907 })
    expect(screen.getByText("First seen:")).toBeInTheDocument()
    expect(screen.getByText("26 Mar 2026")).toBeInTheDocument()
    expect(screen.queryByText("Registered:")).not.toBeInTheDocument()
  })

  it("prefers a real registration over an earlier first observation", () => {
    renderCard({ registeredAt: 1_774_529_219, firstSeenAt: 1_700_000_000 })
    expect(screen.getByText("Registered:")).toBeInTheDocument()
    expect(screen.getByText("26 Mar 2026")).toBeInTheDocument()
    expect(screen.queryByText("First seen:")).not.toBeInTheDocument()
  })

  it("shows a dash for each figure it does not have", () => {
    renderCard()

    expect(screen.getByText("Delegators:")).toBeInTheDocument()
    expect(screen.getByText("Missed ceremonies")).toBeInTheDocument()
    expect(screen.getAllByText("—")).toHaveLength(3)
  })

  it("names the validator by its ENS primary name, marked ENS, with SEF's label beside it", () => {
    renderCard({ ensName: "gnosis.eth" })

    expect(screen.getByRole("link", { name: "gnosis.eth" })).toBeInTheDocument()
    expect(screen.getByText("ENS")).toHaveAttribute("title", "Ethereum Name Service primary name")
    expect(screen.getByText(/SEF lists it as Gnosis/)).toBeInTheDocument()
  })
})
