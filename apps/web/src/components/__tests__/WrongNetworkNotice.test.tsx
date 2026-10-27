import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { useNetworkSwitch } from "@/hooks/useNetworkSwitch"
import { WrongNetworkNotice } from "../WrongNetworkNotice"

const m = vi.hoisted(() => ({
  state: {} as Partial<ReturnType<typeof useNetworkSwitch>>,
  isSafeApp: false,
  switchToActive: vi.fn(),
}))

vi.mock("@/hooks/useNetworkSwitch", () => ({
  useNetworkSwitch: () => ({
    wrongNetwork: true,
    walletChainId: 100,
    canSwitch: true,
    switchToActive: m.switchToActive,
    isSwitching: false,
    switchError: null,
    ...m.state,
  }),
}))
vi.mock("@/lib/safe", () => ({
  get isSafeApp() {
    return m.isSafeApp
  },
}))
vi.mock("@/config/chains", () => ({ activeChain: { id: 1, name: "Ethereum" } }))

describe("WrongNetworkNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.state = {}
    m.isSafeApp = false
  })

  it("renders nothing on the right network", () => {
    m.state = { wrongNetwork: false }
    const { container } = render(<WrongNetworkNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it("names the wallet's chain, says the actions are off, and switches", async () => {
    render(<WrongNetworkNotice />)

    expect(screen.getByRole("region", { name: "Wrong network" })).toHaveTextContent("chain ID 100")
    expect(screen.getByText(/staking, unstaking and claiming are off/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Switch to Ethereum" }))
    expect(m.switchToActive).toHaveBeenCalledOnce()
  })

  it("tells the user to switch in the wallet when the wallet cannot be switched from here", () => {
    m.state = { canSwitch: false }
    render(<WrongNetworkNotice />)

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByText(/Switch it to Ethereum in the wallet itself/)).toBeInTheDocument()
  })

  it("inside a Safe, says to open the app from a Safe on the right network", () => {
    m.state = { canSwitch: false }
    m.isSafeApp = true
    render(<WrongNetworkNotice />)

    expect(screen.getByText("This Safe is on another network. Open the app from a Safe on Ethereum.")).toBeInTheDocument()
  })

  it("says so when the wallet refuses the switch", () => {
    m.state = { switchError: new Error("User rejected the request.") as never }
    render(<WrongNetworkNotice />)

    expect(screen.getByRole("alert")).toHaveTextContent("The wallet did not switch.")
  })
})
