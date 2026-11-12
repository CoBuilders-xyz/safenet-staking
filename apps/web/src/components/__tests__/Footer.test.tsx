import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { SEF_DOCS } from "@cobuilders/safenet-core"

// The override URLs are read at module scope, so each test imports the footer after its stubs.
async function renderFooter() {
  vi.resetModules()
  const { Footer } = await import("../layout/Footer")
  render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("Footer", () => {
  it("names the operator", async () => {
    await renderFooter()

    expect(screen.getByText("Operated by Backstage Online LLC")).toBeInTheDocument()
    expect(screen.getByText("by CoBuilders")).toBeInTheDocument()
  })

  it("links to the in-app pages when no URL is set", async () => {
    vi.stubEnv("VITE_TERMS_URL", "")
    vi.stubEnv("VITE_PRIVACY_URL", "")
    vi.stubEnv("VITE_IMPRINT_URL", "")
    await renderFooter()

    for (const [name, path] of [["Terms", "/terms"], ["Privacy", "/privacy"], ["Imprint", "/imprint"], ["FAQ", "/faq"]] as const) {
      const link = screen.getByRole("link", { name })
      expect(link).toHaveAttribute("href", path)
      expect(link).not.toHaveAttribute("target")
    }
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute("href", SEF_DOCS.home)
  })

  it("gives a URL from the environment precedence over the in-app page", async () => {
    vi.stubEnv("VITE_TERMS_URL", "https://example.com/terms")
    vi.stubEnv("VITE_PRIVACY_URL", "https://example.com/privacy")
    vi.stubEnv("VITE_IMPRINT_URL", "https://example.com/imprint")
    await renderFooter()

    for (const [name, url] of [["Terms", "https://example.com/terms"], ["Privacy", "https://example.com/privacy"], ["Imprint", "https://example.com/imprint"]] as const) {
      const link = screen.getByRole("link", { name })
      expect(link).toHaveAttribute("href", url)
      expect(link).toHaveAttribute("target", "_blank")
    }
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq")
  })
})
