import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConnectButton } from "../wallet/ConnectButton"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockSwitchChain = vi.fn()
const mockUseAccount = vi.fn()
const mockUseConnect = vi.fn()

vi.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useConnect: () => mockUseConnect(),
  useDisconnect: () => ({ disconnect: mockDisconnect }),
  useSwitchChain: () => ({ switchChain: mockSwitchChain, isPending: false, error: null }),
}))

vi.mock("@/hooks/useTokenBalance", () => ({
  useTokenBalance: vi.fn(() => ({ data: 1000n * 10n ** 18n })),
}))

vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}))

vi.mock("@/config/chains", () => ({
  activeChain: { id: 1, name: "Ethereum" },
}))

describe("ConnectButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate injected wallet provider so browserWallet connector is included
    window.ethereum = {} as unknown as typeof window.ethereum
    mockUseConnect.mockReturnValue({
      connect: mockConnect,
      connectors: [
        { id: "browserWallet", uid: "bw-1", name: "Browser Wallet" },
      ],
      error: null,
    })
  })

  it("shows Connect Wallet button when disconnected", () => {
    mockUseAccount.mockReturnValue({ isConnected: false, address: undefined, chain: undefined })

    render(<ConnectButton />)

    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument()
  })

  it("connects directly with single connector on click", async () => {
    mockUseAccount.mockReturnValue({ isConnected: false, address: undefined, chain: undefined })
    const user = userEvent.setup()

    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: "Connect Wallet" }))

    expect(mockConnect).toHaveBeenCalledWith(
      { connector: { id: "browserWallet", uid: "bw-1", name: "Browser Wallet" } },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it("shows switch chain button when on wrong chain", async () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: TEST_ACCOUNTS.user,
      chainId: 11155111, // a chain the app does not support; wagmi then leaves `chain` undefined
      chain: undefined,
      connector: { switchChain: vi.fn() },
    })

    render(<ConnectButton />)

    await userEvent.click(screen.getByRole("button", { name: "Switch to Ethereum" }))
    expect(mockSwitchChain).toHaveBeenCalledWith({ chainId: 1 })
  })

  it("says wrong network without a switch when the wallet cannot switch", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: TEST_ACCOUNTS.user,
      chainId: 100,
      chain: undefined,
      connector: {},
    })

    render(<ConnectButton />)

    expect(screen.getByText("Wrong network")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Switch to Ethereum" })).not.toBeInTheDocument()
  })

  it("shows address and balance when connected on correct chain", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: TEST_ACCOUNTS.user,
      chainId: 1,
    })

    render(<ConnectButton />)

    expect(screen.getByText(/1,000/)).toBeInTheDocument() // balance
    expect(screen.getByText(/0x1111...1111/)).toBeInTheDocument() // truncated address
  })

  it("shows Disconnect button when connected", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: TEST_ACCOUNTS.user,
      chainId: 1,
    })

    render(<ConnectButton />)

    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument()
  })

  it("calls disconnect on button click", async () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: TEST_ACCOUNTS.user,
      chainId: 1,
    })
    const user = userEvent.setup()

    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
