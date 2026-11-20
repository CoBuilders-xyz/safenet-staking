import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { WithdrawalCard } from "../withdrawals/WithdrawalCard"
import { getAddress, zeroAddress } from "viem"
import { AMOUNTS, TEST_ACCOUNTS, MOCK_VALIDATORS } from "@/__tests__/test-data"
import { truncateAddress } from "@/lib/format"

vi.mock("@/hooks/useWrongNetwork", () => ({
  useWrongNetwork: () => false,
}))

vi.mock("@/hooks/useCountdown", () => ({
  useCountdown: vi.fn(() => 0), // default: claimable (0 seconds left)
}))

vi.mock("@/hooks/useStakingReads", () => ({
  useWithdrawDelay: vi.fn(() => ({ data: AMOUNTS.withdrawDelay })),
}))

vi.mock("@/hooks/useValidators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useValidators")>()
  return { ...actual }
})

describe("WithdrawalCard", () => {
  const mockOnClaim = vi.fn()
  const pastClaimableAt = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
  const futureClaimableAt = Math.floor(Date.now() / 1000) + 86400 // 1 day from now

  const defaultProps = {
    amount: AMOUNTS.pendingWithdrawalAmount,
    claimableAt: pastClaimableAt,
    isFirst: true,
    onClaim: mockOnClaim,
    isSigningTx: false,
    isConfirmingTx: false,
    validator: TEST_ACCOUNTS.validator1,
    validators: [...MOCK_VALIDATORS],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders withdrawal amount", () => {
    render(<WithdrawalCard {...defaultProps} />)

    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.getByText(/SAFE/)).toBeInTheDocument()
  })

  it("renders validator label", () => {
    render(<WithdrawalCard {...defaultProps} />)

    expect(screen.getByText(/Gnosis/)).toBeInTheDocument()
  })

  it("finds the name whatever the casing of either address", () => {
    const upper = `0x${TEST_ACCOUNTS.validator1.slice(2).toUpperCase()}` as `0x${string}`
    const { unmount } = render(<WithdrawalCard {...defaultProps} validator={upper} />)
    expect(screen.getByText("Gnosis")).toBeInTheDocument()
    unmount()

    // The list as useValidators returns it: checksummed. The withdrawal's validator in lowercase.
    const checksummed = MOCK_VALIDATORS.map((v) => ({ ...v, address: getAddress(v.address) }))
    render(
      <WithdrawalCard
        {...defaultProps}
        validator={TEST_ACCOUNTS.validator2.toLowerCase() as `0x${string}`}
        validators={checksummed}
      />,
    )
    expect(screen.getByText("Greenfield")).toBeInTheDocument()
  })

  it("shows a placeholder, not an empty gap, while the withdrawal's validator loads", () => {
    render(<WithdrawalCard {...defaultProps} validator={undefined} isValidatorLoading />)

    expect(screen.getByTestId("withdrawal-validator-skeleton")).toBeInTheDocument()
    expect(screen.queryByText("Unknown validator")).not.toBeInTheDocument()
    expect(screen.getByText("Ready to withdraw")).toBeInTheDocument()
  })

  it("shows a placeholder for the name while the validator names load, with the address", () => {
    render(<WithdrawalCard {...defaultProps} validators={undefined} isNameLoading />)

    expect(screen.getByTestId("withdrawal-validator-skeleton")).toBeInTheDocument()
    expect(screen.getAllByText(truncateAddress(TEST_ACCOUNTS.validator1))).toHaveLength(1)
  })

  it("replaces the placeholder with the name once it loads", () => {
    const { rerender } = render(<WithdrawalCard {...defaultProps} validator={undefined} isValidatorLoading />)
    rerender(<WithdrawalCard {...defaultProps} />)

    expect(screen.queryByTestId("withdrawal-validator-skeleton")).not.toBeInTheDocument()
    expect(screen.getByText("Gnosis")).toBeInTheDocument()
  })

  it("shows the short address as the name of a validator the list does not hold", () => {
    const other = "0x9999999999999999999999999999999999999999"
    render(<WithdrawalCard {...defaultProps} validator={other} />)

    expect(screen.getAllByText(truncateAddress(other))).toHaveLength(2)
    expect(screen.queryByText("Unknown validator")).not.toBeInTheDocument()
    expect(screen.queryByTestId("withdrawal-validator-skeleton")).not.toBeInTheDocument()
  })

  it("says Unknown validator only when the withdrawal's validator could not be read", () => {
    const { unmount } = render(<WithdrawalCard {...defaultProps} validator={zeroAddress} />)
    expect(screen.getByText("Unknown validator")).toBeInTheDocument()
    unmount()

    render(<WithdrawalCard {...defaultProps} validator={undefined} />)
    expect(screen.getByText("Unknown validator")).toBeInTheDocument()
  })

  it("keeps the address line when the validator stays unknown, so the card does not shrink", () => {
    const { rerender } = render(<WithdrawalCard {...defaultProps} validator={undefined} isValidatorLoading />)
    expect(screen.queryByTestId("withdrawal-address-spacer")).not.toBeInTheDocument()

    rerender(<WithdrawalCard {...defaultProps} validator={zeroAddress} />)
    expect(screen.getByText("Unknown validator")).toBeInTheDocument()
    expect(screen.getByTestId("withdrawal-address-spacer")).toHaveClass("h-[18px]")

    rerender(<WithdrawalCard {...defaultProps} />)
    expect(screen.queryByTestId("withdrawal-address-spacer")).not.toBeInTheDocument()
    expect(screen.getByText(truncateAddress(TEST_ACCOUNTS.validator1))).toBeInTheDocument()
  })

  it("shows enabled Claim button when claimable", () => {
    render(<WithdrawalCard {...defaultProps} />)

    expect(screen.getByRole("button", { name: /Claim/i })).toBeEnabled()
  })

  it("calls onClaim when Claim button clicked", async () => {
    const user = userEvent.setup()
    render(<WithdrawalCard {...defaultProps} />)

    await user.click(screen.getByRole("button", { name: /Claim/i }))

    expect(mockOnClaim).toHaveBeenCalled()
  })

  it("hides Claim button when not first in queue", () => {
    render(<WithdrawalCard {...defaultProps} isFirst={false} />)

    expect(screen.queryByRole("button", { name: /Claim/i })).not.toBeInTheDocument()
  })

  it("shows signing state on Claim button", () => {
    render(<WithdrawalCard {...defaultProps} isSigningTx={true} />)

    expect(screen.getByText("Signing…")).toBeInTheDocument()
    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("shows confirming state on Claim button", () => {
    render(<WithdrawalCard {...defaultProps} isConfirmingTx={true} />)

    expect(screen.getByText("Confirming…")).toBeInTheDocument()
  })

  it("shows countdown and progress bar when in cooldown", async () => {
    const { useCountdown } = await import("@/hooks/useCountdown")
    vi.mocked(useCountdown).mockReturnValue(86400) // 1 day remaining

    render(<WithdrawalCard {...defaultProps} claimableAt={futureClaimableAt} />)

    // Should show progress bar (cooldown in progress)
    expect(screen.getByText("Cooldown progress")).toBeInTheDocument()
    // Claim button not shown during cooldown
    expect(screen.queryByRole("button", { name: /Claim/i })).not.toBeInTheDocument()
  })
})
