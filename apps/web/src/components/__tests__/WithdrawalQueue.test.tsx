import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { WithdrawalQueue } from "../withdrawals/WithdrawalQueue"
import { MOCK_VALIDATORS } from "@/__tests__/test-data"

const mockClaimWithdrawal = vi.fn()
const mockResetClaim = vi.fn()
const mockToast = vi.fn()

const mockUseAccount = vi.fn()
const mockUsePendingWithdrawals = vi.fn()
const mockUseWithdrawalValidators = vi.fn()
const mockUseClaimWithdrawal = vi.fn()

vi.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useReadContract: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

const mockWrongNetwork = vi.fn(() => false)
vi.mock("@/hooks/useWrongNetwork", () => ({ useWrongNetwork: () => mockWrongNetwork() }))

vi.mock("@/hooks/useWithdrawals", () => ({
  usePendingWithdrawals: () => mockUsePendingWithdrawals(),
}))

vi.mock("@/hooks/useWithdrawalValidators", () => ({
  useWithdrawalValidators: () => mockUseWithdrawalValidators(),
}))

vi.mock("@/hooks/useValidators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useValidators")>()
  return {
    ...actual,
    useValidators: vi.fn(() => ({
      data: [...MOCK_VALIDATORS],
    })),
  }
})

const mockUseBatchClaimWithdrawals = vi.fn()

vi.mock("@/hooks/useStakingWrites", () => ({
  useClaimWithdrawal: () => mockUseClaimWithdrawal(),
  useBatchClaimWithdrawals: () => mockUseBatchClaimWithdrawals(),
}))

vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}))

vi.mock("@/hooks/useCountdown", () => ({
  useCountdown: () => 3600,
}))

describe("WithdrawalQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWrongNetwork.mockReturnValue(false)
    mockUseClaimWithdrawal.mockReturnValue({
      claimWithdrawal: mockClaimWithdrawal,
      isSigningTx: false,
      isConfirmingTx: false,
      isSuccess: false,
      isSafeQueued: false,
      error: null,
      txHash: undefined,
      reset: mockResetClaim,
    })
    mockUseBatchClaimWithdrawals.mockReturnValue({
      batchClaimWithdrawals: vi.fn(),
      supportsBatching: false,
      isSigningTx: false,
      isConfirmingTx: false,
      isSuccess: false,
      isReverted: false,
      error: null,
      reset: vi.fn(),
      txHash: undefined,
    })
    mockUseWithdrawalValidators.mockReturnValue({ data: undefined })
  })

  function renderQueue() {
    return render(
      <TooltipProvider>
        <WithdrawalQueue />
      </TooltipProvider>
    )
  }

  it("shows connect wallet message when disconnected", () => {
    mockUseAccount.mockReturnValue({ isConnected: false })
    mockUsePendingWithdrawals.mockReturnValue({ data: undefined, isLoading: false })

    renderQueue()

    expect(screen.getByText("Connect your wallet to view withdrawal queue.")).toBeInTheDocument()
  })

  it("shows loading skeletons when loading", () => {
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({ data: undefined, isLoading: true })

    const { container } = renderQueue()

    const skeletons = container.querySelectorAll(".animate-pulse")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("shows empty state when no withdrawals", () => {
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({ data: [], isLoading: false })

    renderQueue()

    expect(screen.getByText("No pending withdrawals.")).toBeInTheDocument()
  })

  it("says the queue could not be read, rather than that it is empty, and retries", async () => {
    const refetch = vi.fn()
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })

    renderQueue()

    expect(screen.getByRole("alert")).toHaveTextContent("Your withdrawal queue could not be read from Ethereum.")
    expect(screen.queryByText("No pending withdrawals.")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("disables Claim All while the wallet is on another network", () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 3600)
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({
      data: [{ amount: 10n ** 18n, claimableAt: past }, { amount: 10n ** 18n, claimableAt: past }],
      isLoading: false,
    })
    mockUseBatchClaimWithdrawals.mockReturnValue({ ...mockUseBatchClaimWithdrawals(), supportsBatching: true })

    const { unmount } = renderQueue()
    expect(screen.getByRole("button", { name: /Claim All/ })).toBeEnabled()
    unmount()

    mockWrongNetwork.mockReturnValue(true)
    renderQueue()
    expect(screen.getByRole("button", { name: /Claim All/ })).toBeDisabled()
  })

  it("renders withdrawal cards when withdrawals exist", () => {
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({
      data: [
        { amount: 50n * 10n ** 18n, claimableAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      ],
      isLoading: false,
    })

    renderQueue()

    expect(screen.getByText("Pending Withdrawals")).toBeInTheDocument()
  })

  it("shows FIFO info tooltip button", () => {
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({
      data: [
        { amount: 50n * 10n ** 18n, claimableAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      ],
      isLoading: false,
    })

    renderQueue()

    expect(screen.getByLabelText("Withdrawal queue info")).toBeInTheDocument()
  })

  it("calls useClaimWithdrawal reset after successful claim (regression: infinite toast loop)", () => {
    mockUseAccount.mockReturnValue({ isConnected: true })
    mockUsePendingWithdrawals.mockReturnValue({
      data: [
        { amount: 50n * 10n ** 18n, claimableAt: BigInt(Math.floor(Date.now() / 1000) - 3600) },
      ],
      isLoading: false,
    })
    mockUseClaimWithdrawal.mockReturnValue({
      claimWithdrawal: mockClaimWithdrawal,
      isSigningTx: false,
      isConfirmingTx: false,
      isSuccess: true,
      isSafeQueued: false,
      error: null,
      txHash: "0xabc",
      reset: mockResetClaim,
    })

    renderQueue()

    // reset must be called to clear isSuccess and prevent infinite re-renders
    expect(mockResetClaim).toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", title: "Withdrawal claimed" }),
    )
  })
})
