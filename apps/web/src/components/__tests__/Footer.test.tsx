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

  it("shows the release version and the short commit, with the full commit and its time as the title", async () => {
    vi.stubEnv("VITE_RELEASE_VERSION", "web-v20261119.0")
    vi.stubEnv("VITE_BUILD_COMMIT", "0123456789abcdef0123456789abcdef01234567")
    vi.stubEnv("VITE_BUILD_TIME", "2026-11-19T12:00:00Z")
    await renderFooter()

    const build = screen.getByTestId("build-id")
    expect(build).toHaveTextContent("web-v20261119.0 · 0123456")
    expect(build).toHaveAttribute("title", "0123456789abcdef0123456789abcdef01234567 · 2026-11-19T12:00:00Z")
  })

  it("shows the short commit alone for a build that is not a release", async () => {
    vi.stubEnv("VITE_RELEASE_VERSION", "")
    vi.stubEnv("VITE_BUILD_COMMIT", "0123456789abcdef0123456789abcdef01234567")
    await renderFooter()

    expect(screen.getByTestId("build-id")).toHaveTextContent(/^0123456$/)
  })

  it("shows dev when no commit was baked in", async () => {
    vi.stubEnv("VITE_RELEASE_VERSION", "")
    vi.stubEnv("VITE_BUILD_COMMIT", "")
    vi.stubEnv("VITE_BUILD_TIME", "")
    await renderFooter()

    const build = screen.getByTestId("build-id")
    expect(build).toHaveTextContent(/^dev$/)
    expect(build).not.toHaveAttribute("title")
  })
})
