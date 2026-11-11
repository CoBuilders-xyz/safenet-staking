import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { DEPLOYMENTS, DEFAULT_CHAIN_ID, GEO_LOOKUPS, IPFS_GATEWAYS, SEF_DOCS } from "@cobuilders/safenet-core"
import { ContentPage } from "../ContentPage"
import { CONTENT_PAGES, type ContentPageName } from "@/config/legal"
import { i18n } from "@/i18n"

const PLACEHOLDER = "Placeholder. The final text is pending legal review."
const ENGLISH_ONLY = "This text is only available in English."
const TITLES: Record<ContentPageName, string> = {
  imprint: "Imprint",
  terms: "Terms of use",
  privacy: "Privacy policy",
  faq: "Frequently asked questions",
}

/** Each page under its own route, as App.tsx mounts them. */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {CONTENT_PAGES.map((name) => (
          <Route key={name} path={`/${name}`} element={<ContentPage name={name} />} />
        ))}
      </Routes>
    </MemoryRouter>,
  )
}

const host = (url: string) => new URL(url).host

// jsdom does not implement scrollTo.
const scrollTo = vi.fn()
beforeEach(() => {
  scrollTo.mockClear()
  vi.stubGlobal("scrollTo", scrollTo)
})

describe("ContentPage", () => {
  it.each(CONTENT_PAGES)("renders /%s with its title", (name) => {
    renderAt(`/${name}`)

    expect(screen.getByRole("heading", { level: 1, name: TITLES[name] })).toBeInTheDocument()
    expect(screen.queryByText(ENGLISH_ONLY)).toBeNull()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it.each(["imprint", "terms", "privacy"] as const)("marks /%s as placeholder text", (name) => {
    renderAt(`/${name}`)

    expect(screen.getByRole("note")).toHaveTextContent(PLACEHOLDER)
  })

  it("does not mark the FAQ as placeholder text", () => {
    renderAt("/faq")

    expect(screen.queryByText(PLACEHOLDER)).toBeNull()
  })

  it("says the text is English only in another language, and marks it as English", async () => {
    await i18n.changeLanguage("es")
    const { container } = renderAt("/privacy")

    expect(screen.getByText("Este texto solo está disponible en inglés.")).toBeInTheDocument()
    expect(screen.getByText("Texto provisional. El texto final está pendiente de revisión legal.")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "Privacy policy" }).closest("[lang]")).toHaveAttribute("lang", "en")
    expect(container.querySelector("[lang='en']")).not.toBeNull()
  })

  it("names the operator and leaves a slot for each detail the lawyer supplies", () => {
    const { container } = renderAt("/imprint")

    expect(screen.getByText("Backstage Online LLC")).toBeInTheDocument()
    for (const slot of ["[TODO: operator registered address]", "[TODO: contact email]", "[TODO: jurisdiction and governing law]"]) {
      expect(container).toHaveTextContent(slot)
    }
  })

  it("leaves the governing law open in the terms and the data controller open in the privacy policy", () => {
    expect(renderAt("/terms").container).toHaveTextContent("[TODO: jurisdiction and governing law]")
    expect(renderAt("/privacy").container).toHaveTextContent("[TODO: data controller")
  })

  it("names in the privacy policy every third-party host that core gives the browser", () => {
    const { container } = renderAt("/privacy")

    const hosts = [...GEO_LOOKUPS.map((l) => l.url), ...DEPLOYMENTS[DEFAULT_CHAIN_ID].rpc, ...IPFS_GATEWAYS].map(host)
    for (const name of hosts) expect(container).toHaveTextContent(name)
    for (const variable of ["VITE_GEOBLOCK_CACHE_DAYS", "VITE_PLAUSIBLE_DOMAIN", "VITE_SANCTIONS_API_URL"]) {
      expect(container).toHaveTextContent(variable)
    }
  })

  it("links the FAQ to SEF's documentation and to the other pages", () => {
    renderAt("/faq")

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"))
    expect(hrefs).toEqual(expect.arrayContaining([SEF_DOCS.home, SEF_DOCS.faq, SEF_DOCS.rewards, "/imprint", "/privacy", "/terms"]))
  })
})
