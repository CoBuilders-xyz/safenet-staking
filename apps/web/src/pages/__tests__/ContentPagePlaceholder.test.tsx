import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

// No text is a placeholder today. A text marked as one still gets its notice.
vi.mock("@/content/en/imprint.md?raw", () => ({ default: "---\nstatus: placeholder\n---\n\n# Imprint\n" }))

describe("ContentPage, a text marked as placeholder", () => {
  it("shows the placeholder notice above the text", async () => {
    vi.stubGlobal("scrollTo", vi.fn())
    const { ContentPage } = await import("../ContentPage")
    render(
      <MemoryRouter>
        <ContentPage name="imprint" />
      </MemoryRouter>,
    )

    expect(screen.getByRole("note")).toHaveTextContent("Placeholder. The final text is pending legal review.")
    expect(screen.getByRole("heading", { level: 1, name: "Imprint" })).toBeInTheDocument()
  })
})
