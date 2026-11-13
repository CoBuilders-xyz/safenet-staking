import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { ConnectButton } from "../wallet/ConnectButton"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { TERMS_ACCEPTANCE_STORAGE_KEY, TERMS_VERSION } from "@/config/terms"
import { acceptTerms, resetTermsAcceptanceForTests } from "@/lib/termsAcceptance"

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
    // The terms are accepted already, so a click connects as it always did. The describe block
    // at the end covers a visitor who has not accepted them.
    localStorage.removeItem(TERMS_ACCEPTANCE_STORAGE_KEY)
    resetTermsAcceptanceForTests()
    acceptTerms()
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

describe("ConnectButton, before the terms are accepted", () => {
  const connectors = [
    { id: "browserWallet", uid: "bw-1", name: "Browser Wallet" },
    { id: "walletConnect", uid: "wc-1", name: "WalletConnect" },
  ]

  const renderButton = () =>
    render(
      <MemoryRouter>
        <ConnectButton />
      </MemoryRouter>,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(TERMS_ACCEPTANCE_STORAGE_KEY)
    resetTermsAcceptanceForTests()
    window.ethereum = {} as unknown as typeof window.ethereum
    mockUseAccount.mockReturnValue({ isConnected: false, address: undefined, chain: undefined })
    mockUseConnect.mockReturnValue({ connect: mockConnect, connectors: [connectors[0]], error: null })
  })

  it("asks for the Terms of use and the Privacy policy, with a link to each, and connects nothing yet", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))

    const dialog = await screen.findByRole("dialog", { name: "Before you connect" })
    expect(dialog).toHaveTextContent("By connecting, you agree to the Terms of use and the Privacy policy.")
    const terms = screen.getByRole("link", { name: "Terms of use" })
    expect(terms).toHaveAttribute("href", "/terms")
    expect(terms).toHaveAttribute("target", "_blank")
    const privacy = screen.getByRole("link", { name: "Privacy policy" })
    expect(privacy).toHaveAttribute("href", "/privacy")
    expect(privacy).toHaveAttribute("target", "_blank")
    expect(mockConnect).not.toHaveBeenCalled()
    expect(localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)).toBeNull()
  })

  it("records the accepted version and connects when the visitor agrees", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    await userEvent.click(await screen.findByRole("button", { name: "Agree and connect" }))

    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockConnect.mock.calls[0]![0]).toEqual({ connector: connectors[0] })
    const record = JSON.parse(localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)!)
    expect(record.version).toBe(TERMS_VERSION)
    expect(Number.isNaN(Date.parse(record.acceptedAt))).toBe(false)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("does not ask again once accepted", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    await userEvent.click(await screen.findByRole("button", { name: "Agree and connect" }))
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it("connects nothing and records nothing when the visitor cancels, and asks again next time", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mockConnect).not.toHaveBeenCalled()
    expect(localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)).toBeNull()
    // Focus returns to the button that opened the dialog.
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Wallet" })).toHaveFocus())

    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    expect(await screen.findByRole("dialog", { name: "Before you connect" })).toBeInTheDocument()
  })

  it("asks again when the accepted version is not the current one", async () => {
    localStorage.setItem(TERMS_ACCEPTANCE_STORAGE_KEY, JSON.stringify({ version: "2000-01-01", acceptedAt: "2000-01-01T00:00:00.000Z" }))
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))

    expect(await screen.findByRole("dialog", { name: "Before you connect" })).toBeInTheDocument()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it("opens the wallet menu after the visitor agrees, when there is more than one wallet", async () => {
    mockUseConnect.mockReturnValue({ connect: mockConnect, connectors, error: null })
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))

    expect(screen.queryByRole("menu")).toBeNull()
    await userEvent.click(await screen.findByRole("button", { name: "Agree and connect" }))

    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(mockConnect).not.toHaveBeenCalled()
    // Focus is on the first wallet and stays there, so Enter picks it.
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Browser Wallet" })).toHaveFocus())
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    expect(screen.getByRole("menuitem", { name: "Browser Wallet" })).toHaveFocus()
    await userEvent.click(screen.getByRole("menuitem", { name: "WalletConnect" }))
    expect(mockConnect.mock.calls[0]![0]).toEqual({ connector: connectors[1] })
  })

  it("asks again at the wallet menu when the acceptance ended while the menu was open", async () => {
    mockUseConnect.mockReturnValue({ connect: mockConnect, connectors, error: null })
    acceptTerms()
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    expect(screen.getByRole("menu")).toBeInTheDocument()

    // Another tab cleared the record.
    localStorage.removeItem(TERMS_ACCEPTANCE_STORAGE_KEY)
    window.dispatchEvent(new StorageEvent("storage", { key: TERMS_ACCEPTANCE_STORAGE_KEY }))
    await userEvent.click(screen.getByRole("menuitem", { name: "WalletConnect" }))

    expect(mockConnect).not.toHaveBeenCalled()
    expect(await screen.findByRole("dialog", { name: "Before you connect" })).toBeInTheDocument()
  })
})
