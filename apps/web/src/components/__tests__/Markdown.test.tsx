import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { Markdown } from "../Markdown"
import { parseMarkdown } from "@/lib/markdown"

const renderMarkdown = (source: string) =>
  render(
    <MemoryRouter>
      <Markdown blocks={parseMarkdown(source).blocks} />
    </MemoryRouter>,
  )

describe("Markdown", () => {
  it("renders headings, paragraphs, lists and emphasis as elements", () => {
    renderMarkdown("# Title\n\n## Section\n\nSome **bold** text and `code`.\n\n1. one\n2. two\n\n- a\n- b")

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument()
    expect(screen.getByText("bold").tagName).toBe("STRONG")
    expect(screen.getByText("code").tagName).toBe("CODE")
    expect(screen.getAllByRole("list")).toHaveLength(2)
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["one", "two", "a", "b"])
  })

  it("opens an external link in a new tab and keeps an in-app link in the app", () => {
    renderMarkdown("[SEF](https://example.org/docs) and [Terms](#/terms)")

    const external = screen.getByRole("link", { name: "SEF" })
    expect(external).toHaveAttribute("href", "https://example.org/docs")
    expect(external).toHaveAttribute("target", "_blank")
    expect(external).toHaveAttribute("rel", "noopener noreferrer")
    const internal = screen.getByRole("link", { name: "Terms" })
    expect(internal).toHaveAttribute("href", "/terms")
    expect(internal).not.toHaveAttribute("target")
  })

  it("shows HTML in the source as text, never as elements", () => {
    const { container } = renderMarkdown('Hello <img src=x onerror="alert(1)"> <script>alert(1)</script>\n\n[x](javascript:alert(1))')

    expect(container.querySelector("img, script")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(container.textContent).toContain("[x](javascript:alert(1))")
  })
})
