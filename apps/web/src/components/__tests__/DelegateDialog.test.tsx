import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { DelegateDialog } from "../staking/DelegateDialog"
import { AMOUNTS, MOCK_VALIDATORS, TEST_ACCOUNTS } from "@/__tests__/test-data"

// --- Mock all hooks used by DelegateDialog ---

const mockStake = vi.fn()
const mockResetStake = vi.fn()
const mockBatchApproveAndStake = vi.fn()
const mockResetBatch = vi.fn()
const mockApproveExact = vi.fn()
const mockApproveUnlimited = vi.fn()
const mockResetApprovalFlow = vi.fn()
const mockToast = vi.fn()

vi.mock("@/hooks/useTokenBalance", () => ({
  useTokenBalance: vi.fn(() => ({ data: AMOUNTS.userBalance })),
}))

const mockApprovalFlow = {
  needsApproval: false,
  approvalType: null as "exact" | "unlimited" | null,
  isApprovalPending: false,
  isSigningApproval: false,
  isConfirmingApproval: false,
  approveExact: mockApproveExact,
  approveUnlimited: mockApproveUnlimited,
  resetApprovalFlow: mockResetApprovalFlow,
}

vi.mock("@/hooks/useValidators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useValidators")>()),
  useValidators: () => ({ data: MOCK_VALIDATORS, isLoading: false, error: null }),
}))

vi.mock("@/hooks/useWrongNetwork", () => ({
  useWrongNetwork: () => false,
}))

vi.mock("@/hooks/useApprovalFlow", () => ({
  useApprovalFlow: vi.fn(() => mockApprovalFlow),
}))

const mockUseStake = {
  stake: mockStake,
  isSigningTx: false,
  isConfirmingTx: false,
  isSuccess: false,
  isSafeQueued: false,
  error: null as Error | null,
  reset: mockResetStake,
  txHash: undefined as `0x${string}` | undefined,
}

const mockUseBatchStake = {
  batchApproveAndStake: mockBatchApproveAndStake,
  supportsBatching: false,
  isSigningTx: false,
  isConfirmingTx: false,
  isSuccess: false,
  isReverted: false,
  error: null,
  reset: mockResetBatch,
  txHash: undefined,
}

vi.mock("@/hooks/useStakingWrites", () => ({
  useStake: vi.fn(() => mockUseStake),
  useBatchStake: vi.fn(() => mockUseBatchStake),
}))

vi.mock("@/hooks/useStakingReads", () => ({
  useWithdrawDelay: vi.fn(() => ({ data: AMOUNTS.withdrawDelay })),
}))

vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}))

vi.mock("@/hooks/useGasEstimate", () => ({
  useGasEstimate: vi.fn(() => ({ estimatedCost: null, isLoading: false })),
}))

describe("DelegateDialog", () => {
  const defaultProps = {
    validator: TEST_ACCOUNTS.validator1,
    open: true,
    onOpenChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to defaults
    Object.assign(mockApprovalFlow, {
      needsApproval: false,
      approvalType: null,
      isApprovalPending: false,
      isSigningApproval: false,
      isConfirmingApproval: false,
    })
    Object.assign(mockUseStake, {
      isSigningTx: false,
      isConfirmingTx: false,
      isSuccess: false,
      isSafeQueued: false,
      error: null,
      txHash: undefined,
    })
    Object.assign(mockUseBatchStake, {
      supportsBatching: false,
      isSigningTx: false,
      isConfirmingTx: false,
      isSuccess: false,
      isReverted: false,
      error: null,
    })
  })

  it("renders dialog with title and description", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByText("Stake SAFE")).toBeInTheDocument()
    expect(screen.getByText(/Stake tokens to validator/)).toBeInTheDocument()
  })

  it("renders amount input with balance", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByPlaceholderText("0.0")).toBeInTheDocument()
    expect(screen.getByText(/SAFE Balance:/)).toBeInTheDocument()
  })

  it("shows Stake button when no approval needed", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument()
  })

  it("disables Stake button when amount is empty", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled()
  })

  it("enables Stake button when valid amount entered", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    const input = screen.getByPlaceholderText("0.0")
    await user.type(input, "100")

    expect(screen.getByRole("button", { name: "Stake" })).toBeEnabled()
  })

  it("calls stake with correct args when Stake button clicked", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    const input = screen.getByPlaceholderText("0.0")
    await user.type(input, "100")
    await user.click(screen.getByRole("button", { name: "Stake" }))
    expect(mockStake).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Confirm stake" }))

    expect(mockStake).toHaveBeenCalledWith(
      TEST_ACCOUNTS.validator1,
      100n * 10n ** 18n,
    )
  })

  it("shows Stake button when needsApproval is false", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    // needsApproval is false by default, so Stake button shows
    expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument()
  })

  it("shows approve buttons when needsApproval is true", async () => {
    mockApprovalFlow.needsApproval = true

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    const input = screen.getByPlaceholderText("0.0")
    await user.type(input, "100")

    expect(screen.getByRole("button", { name: "Approve exact amount" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve unlimited" })).toBeInTheDocument()
  })

  it("calls approveExact when exact button clicked", async () => {
    mockApprovalFlow.needsApproval = true

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")
    await user.click(screen.getByRole("button", { name: "Approve exact amount" }))

    expect(mockApproveExact).toHaveBeenCalled()
  })

  it("calls approveUnlimited when unlimited button clicked", async () => {
    mockApprovalFlow.needsApproval = true

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")
    await user.click(screen.getByRole("button", { name: "Approve unlimited" }))

    expect(mockApproveUnlimited).toHaveBeenCalled()
  })

  it("shows signing state on Stake button", () => {
    mockUseStake.isSigningTx = true

    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByText("Confirm in Wallet…")).toBeInTheDocument()
  })

  it("shows confirming state on Stake button", () => {
    mockUseStake.isConfirmingTx = true

    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByText("Confirming onchain…")).toBeInTheDocument()
  })

  it("shows unstaking period info", () => {
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByRole("button", { name: "Unstaking period" })).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveTextContent("Unstaking period: 7 days")
  })

  it("percentage buttons set correct amounts", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    // Click 25%
    await user.click(screen.getByRole("button", { name: "25%" }))
    expect(screen.getByPlaceholderText("0.0")).toHaveValue("250")

    // Click MAX
    await user.click(screen.getByRole("button", { name: "MAX" }))
    expect(screen.getByPlaceholderText("0.0")).toHaveValue("1000")
  })

  it("shows insufficient balance error when amount exceeds balance", async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "2000")

    expect(screen.getByText("You do not have enough SAFE to stake this amount.")).toBeInTheDocument()
  })

  it("resets form when dialog closes", () => {
    const { rerender } = render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    rerender(<TooltipProvider><DelegateDialog {...defaultProps} open={false} /></TooltipProvider>)

    expect(mockResetApprovalFlow).toHaveBeenCalled()
    expect(mockResetStake).toHaveBeenCalled()
    expect(mockResetBatch).toHaveBeenCalled()
  })

  it("keeps a stake that is still confirming when the dialog closes, so its toast still shows", () => {
    mockUseStake.isConfirmingTx = true
    const { rerender } = render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    rerender(<TooltipProvider><DelegateDialog {...defaultProps} open={false} /></TooltipProvider>)

    expect(mockResetStake).not.toHaveBeenCalled()
  })

  it("shows zero balance message", async () => {
    const mod = await import("@/hooks/useTokenBalance")
    vi.mocked(mod.useTokenBalance).mockReturnValue({ data: 0n } as ReturnType<typeof mod.useTokenBalance>)

    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(screen.getByText("You do not have enough SAFE to stake.")).toBeInTheDocument()

    // Restore for subsequent tests
    vi.mocked(mod.useTokenBalance).mockReturnValue({ data: AMOUNTS.userBalance } as ReturnType<typeof mod.useTokenBalance>)
  })

  it("shows signing approval state on approve button", async () => {
    mockApprovalFlow.needsApproval = true
    mockApprovalFlow.isSigningApproval = true
    mockApprovalFlow.approvalType = "unlimited"

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")

    expect(screen.getByText("Confirm Approval in Wallet…")).toBeInTheDocument()
  })

  it("shows confirming approval state on approve button", async () => {
    mockApprovalFlow.needsApproval = true
    mockApprovalFlow.isConfirmingApproval = true
    mockApprovalFlow.approvalType = "unlimited"

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")

    expect(screen.getByText("Approval confirming…")).toBeInTheDocument()
  })

  it("shows success toast after stake completes", () => {
    mockUseStake.isSuccess = true
    mockUseStake.txHash = "0xbbbb" as `0x${string}`

    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        title: "Delegation successful",
      })
    )
  })

  it("does not render stepper component", async () => {
    mockApprovalFlow.needsApproval = true

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")

    // Stepper was removed — verify no step indicators render
    expect(screen.queryByText("Approve")).not.toBeInTheDocument()
    expect(screen.queryByText("Done")).not.toBeInTheDocument()
  })

  it("uses batch approve and stake when batching is supported", async () => {
    mockUseBatchStake.supportsBatching = true
    mockApprovalFlow.needsApproval = true

    const user = userEvent.setup()
    render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

    await user.type(screen.getByPlaceholderText("0.0"), "100")
    await user.click(screen.getByRole("button", { name: "Stake" }))
    expect(mockBatchApproveAndStake).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Confirm stake" }))

    expect(mockBatchApproveAndStake).toHaveBeenCalledWith(
      TEST_ACCOUNTS.validator1,
      100n * 10n ** 18n,
    )
  })

  describe("what happens if, before the wallet confirms", () => {
    it("names the amount and validator, and answers each scenario from the contract's figures", async () => {
      const user = userEvent.setup()
      render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

      await user.type(screen.getByPlaceholderText("0.0"), "100")
      await user.click(screen.getByRole("button", { name: "Stake" }))

      const review = screen.getByRole("region", { name: /Before you stake 100 SAFE with/ })
      expect(review).toHaveTextContent(MOCK_VALIDATORS[0].label)
      for (const question of [
        "…I want my SAFE back?",
        "…I want to move to another validator?",
        "…this validator's participation drops?",
        "…something goes wrong?",
        "…rewards are lower than I expect?",
      ]) {
        expect(screen.getByText(question)).toBeInTheDocument()
      }
      // The unstaking period is the contract's, in words.
      expect(screen.getByRole("button", { name: "7 days" })).toBeInTheDocument()
      expect(review).toHaveTextContent("not currently subject to slashing")
      expect(review).toHaveTextContent("Nothing is sent before that.")
    })

    it("goes back to the form without sending anything", async () => {
      const user = userEvent.setup()
      render(<TooltipProvider><DelegateDialog {...defaultProps} /></TooltipProvider>)

      await user.type(screen.getByPlaceholderText("0.0"), "100")
      await user.click(screen.getByRole("button", { name: "Stake" }))
      await user.click(screen.getByRole("button", { name: "Back" }))

      expect(screen.queryByRole("region", { name: /Before you stake/ })).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText("0.0")).toHaveValue("100")
      expect(mockStake).not.toHaveBeenCalled()
    })
  })
})
