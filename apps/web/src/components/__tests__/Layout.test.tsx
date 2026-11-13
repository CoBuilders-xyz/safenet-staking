import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { Layout } from "../layout/Layout"

vi.mock("../layout/Header", () => ({
  Header: () => <div data-testid="header">Header</div>,
}))

vi.mock("../WrongNetworkNotice", () => ({
  WrongNetworkNotice: () => <div data-testid="wrong-network">Wrong network</div>,
}))

vi.mock("../layout/Footer", () => ({
  Footer: () => <div data-testid="footer">Footer</div>,
}))

describe("Layout", () => {
  it("renders header, main content area, and footer", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    )

    expect(screen.getByTestId("header")).toBeInTheDocument()
    expect(screen.getByTestId("footer")).toBeInTheDocument()
    expect(screen.getByText("Skip to main content")).toBeInTheDocument()
    expect(screen.getByRole("main")).toContainElement(screen.getByTestId("wrong-network"))
  })

  it("standalone, for the legal pages: no wrong-network notice", () => {
    render(
      <MemoryRouter>
        <Layout standalone />
      </MemoryRouter>,
    )

    expect(screen.getByTestId("header")).toBeInTheDocument()
    expect(screen.getByTestId("footer")).toBeInTheDocument()
    expect(screen.queryByTestId("wrong-network")).toBeNull()
  })

  it("moves focus to the content from the skip link without changing the route", async () => {
    window.location.hash = "#/privacy"
    render(
      <MemoryRouter>
        <Layout standalone />
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole("link", { name: "Skip to main content" }))
    expect(screen.getByRole("main")).toHaveFocus()
    expect(window.location.hash).toBe("#/privacy")
  })
})
