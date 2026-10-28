import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { WithdrawalsPage } from "../WithdrawalsPage"

// The terms render as their words here; Term has its own tests.
vi.mock("@/components/ui/term", () => ({ Term: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock("@/hooks/useStakingReads", () => ({ useWithdrawDelay: () => ({ data: 172_800n }) }))

vi.mock("@/components/withdrawals/WithdrawalQueue", () => ({
  WithdrawalQueue: () => <div data-testid="withdrawal-queue">WithdrawalQueue</div>,
}))

describe("WithdrawalsPage", () => {
  it("renders heading and description", () => {
    render(<WithdrawalsPage />)

    expect(screen.getByText("Withdrawals")).toBeInTheDocument()
    expect(screen.getByText(/Manage your pending withdrawals/)).toBeInTheDocument()
  })

  it("renders WithdrawalQueue", () => {
    render(<WithdrawalsPage />)

    expect(screen.getByTestId("withdrawal-queue")).toBeInTheDocument()
  })
})
