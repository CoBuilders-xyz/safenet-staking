import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { ConnectButton } from "../wallet/ConnectButton"
import { TERMS_ACCEPTANCE_STORAGE_KEY, TERMS_VERSION } from "@/config/terms"
import { acceptTerms, resetTermsAcceptanceForTests } from "@/lib/termsAcceptance"

/**
 * Inside Safe nothing is clicked to connect: the Safe connector connects by itself, once the
 * terms are accepted (useAutoConnect). So the button is there only to ask for them.
 */
const connect = vi.fn()
vi.mock("@/lib/safe", () => ({ isSafeApp: true }))
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false, address: undefined, chain: undefined }),
  useConnect: () => ({ connect, connectors: [{ id: "safe", uid: "safe-1", name: "Safe" }], error: null }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false, error: null }),
}))
vi.mock("@/hooks/useTokenBalance", () => ({ useTokenBalance: () => ({ data: undefined }) }))
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/config/chains", () => ({ activeChain: { id: 1, name: "Ethereum" } }))

const renderButton = () =>
  render(
    <MemoryRouter>
      <ConnectButton />
    </MemoryRouter>,
  )

beforeEach(() => {
  connect.mockClear()
  localStorage.removeItem(TERMS_ACCEPTANCE_STORAGE_KEY)
  resetTermsAcceptanceForTests()
})

describe("ConnectButton inside Safe", () => {
  it("shows no button once the terms are accepted", () => {
    acceptTerms()
    renderButton()

    expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull()
  })

  it("asks for the terms first, records the acceptance, and leaves the connection to the Safe connector", async () => {
    renderButton()
    await userEvent.click(screen.getByRole("button", { name: "Connect Wallet" }))
    await userEvent.click(await screen.findByRole("button", { name: "Agree and connect" }))

    expect(JSON.parse(localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)!).version).toBe(TERMS_VERSION)
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(connect).not.toHaveBeenCalled()
  })
})
