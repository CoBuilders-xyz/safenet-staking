import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { RestrictedScreen } from "../RestrictedScreen"

vi.mock("@/components/layout/Footer", () => ({
  Footer: () => <div data-testid="footer">Footer</div>,
}))

describe("RestrictedScreen", () => {
  it("names the gate that refused, why, and what the visitor can do", () => {
    render(<RestrictedScreen restriction={{ gate: "geoblock", reason: "region", country: "CU" }} />)

    expect(screen.getByRole("heading", { name: "Access Restricted" })).toBeInTheDocument()
    expect(screen.getByText("Closed by: Location check")).toBeInTheDocument()
    expect(screen.getByText(/unavailable in Cuba, where your connection appears to be/)).toBeInTheDocument()
    expect(screen.getByText("This interface cannot lift the restriction.")).toBeInTheDocument()
  })

  it("renders the actions it is given", () => {
    render(
      <RestrictedScreen
        restriction={{ gate: "walletSanctions", reason: "unavailable" }}
        actions={<button>Try again</button>}
      />,
    )

    expect(screen.getByRole("heading", { name: "Wallet Check Failed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("renders footer", () => {
    render(<RestrictedScreen restriction={{ gate: "sanctionsApi", reason: "refused" }} />)

    expect(screen.getByTestId("footer")).toBeInTheDocument()
  })
})
