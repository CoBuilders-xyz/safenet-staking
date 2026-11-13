import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { Header } from "../layout/Header"

const mockToggle = vi.fn()

vi.mock("@/hooks/useDarkMode", () => ({
  useDarkMode: () => ({ isDark: false, toggle: mockToggle }),
}))

vi.mock("@/components/wallet/ConnectButton", () => ({
  ConnectButton: () => <button>Connect Wallet</button>,
}))

describe("Header", () => {
  it("renders logo and nav links", () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    const links = screen.getAllByRole("link").map((l) => l.textContent)
    expect(links.indexOf("Overview")).toBeLessThan(links.indexOf("My stake"))
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "My stake" })).toHaveAttribute("href", "/dashboard")
    expect(screen.getByText("Validators")).toBeInTheDocument()
    expect(screen.getByText("Withdrawals")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Rewards" })).toHaveAttribute("href", "/rewards")
  })

  it("renders dark mode toggle button", () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText("Switch to dark mode")).toBeInTheDocument()
  })

  it("calls toggle on dark mode button click", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    await user.click(screen.getByLabelText("Switch to dark mode"))
    expect(mockToggle).toHaveBeenCalled()
  })

  it("renders mobile menu button", () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText("Open menu")).toBeInTheDocument()
  })

  it("toggles mobile menu on click", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

    await user.click(screen.getByLabelText("Open menu"))
    expect(screen.getByLabelText("Close menu")).toBeInTheDocument()
  })

  it("standalone, for the legal pages: no navigation and no wallet control, and one link back", () => {
    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <Header standalone />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: "Back to Overview" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument()
    for (const name of ["My stake", "Validators", "Withdrawals", "Rewards", "Alerts"]) {
      expect(screen.queryByRole("link", { name })).toBeNull()
    }
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull()
  })
})
