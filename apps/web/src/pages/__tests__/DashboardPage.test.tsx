import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { DashboardPage } from "../DashboardPage"

const { mockUseAccount } = vi.hoisted(() => ({ mockUseAccount: vi.fn() }))

vi.mock("wagmi", () => ({ useAccount: () => mockUseAccount() }))

vi.mock("@/components/wallet/ConnectButton", () => ({
  ConnectButton: () => <button>Connect Wallet</button>,
}))

// The terms render as their words here; Term has its own tests.
vi.mock("@/components/ui/term", () => ({ Term: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

// Mock all child components to isolate page-level rendering
vi.mock("@/components/dashboard/StatsOverview", () => ({
  StatsOverview: () => <div data-testid="stats-overview">StatsOverview</div>,
}))

vi.mock("@/components/dashboard/QuickActions", () => ({
  QuickActions: () => <div data-testid="quick-actions">QuickActions</div>,
}))

vi.mock("@/components/dashboard/StakingSection", () => ({
  StakingSection: () => <div data-testid="staking-section">StakingSection</div>,
}))

vi.mock("@/components/dashboard/StakeDistribution", () => ({
  StakeDistribution: () => <div data-testid="stake-distribution">StakeDistribution</div>,
}))

vi.mock("@/components/PageHero", () => ({
  PageHero: (props: Record<string, unknown>) => (
    <div data-testid="page-hero">
      <h1>{String(props.title)}</h1>
      <p>{props.subtitle as React.ReactNode}</p>
    </div>
  ),
}))

const renderPage = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>)

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseAccount.mockReturnValue({ isConnected: true })
  })

  it("renders heading and description", () => {
    renderPage()

    expect(screen.getByText("Stake your SAFE")).toBeInTheDocument()
    expect(screen.getByText(/Earn rewards for helping secure/)).toBeInTheDocument()
  })

  it("renders all child sections when connected", () => {
    renderPage()

    expect(screen.getByTestId("page-hero")).toBeInTheDocument()
    expect(screen.getByTestId("stats-overview")).toBeInTheDocument()
    expect(screen.getByTestId("quick-actions")).toBeInTheDocument()
    expect(screen.getByTestId("staking-section")).toBeInTheDocument()
    expect(screen.getByTestId("stake-distribution")).toBeInTheDocument()
    expect(screen.queryByText("Connect your wallet to see your stakes, rewards, and positions")).not.toBeInTheDocument()
  })

  it("shows only the hero and a connect prompt when disconnected", () => {
    mockUseAccount.mockReturnValue({ isConnected: false })
    renderPage()

    expect(screen.getByTestId("page-hero")).toBeInTheDocument()
    expect(screen.getByText("Connect your wallet to see your stakes, rewards, and positions")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Browse validators" })).toHaveAttribute("href", "/validators")
    for (const id of ["stats-overview", "quick-actions", "staking-section", "stake-distribution"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
  })
})
