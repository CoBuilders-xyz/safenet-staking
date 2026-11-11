import { describe, it, expect } from "vitest"
import { isSafeHref, parseInline, parseMarkdown } from "../markdown"

describe("parseMarkdown", () => {
  it("reads the front matter and leaves it out of the blocks", () => {
    const doc = parseMarkdown("---\nstatus: placeholder\n---\n\n# Title\n")
    expect(doc.meta).toEqual({ status: "placeholder" })
    expect(doc.blocks).toEqual([{ type: "heading", level: 1, children: [{ type: "text", text: "Title" }] }])
  })

  it("has no front matter without the opening line", () => {
    expect(parseMarkdown("# Title\n\n---\n").meta).toEqual({})
  })

  it("joins the lines of a paragraph and separates paragraphs on a blank line", () => {
    const { blocks } = parseMarkdown("one\ntwo\n\nthree\n## Next")
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "one two" }] },
      { type: "paragraph", children: [{ type: "text", text: "three" }] },
      { type: "heading", level: 2, children: [{ type: "text", text: "Next" }] },
    ])
  })

  it("reads lists, their numbering and a list nested under an item", () => {
    const { blocks } = parseMarkdown("3. first\n4. second\n   - inner\n\n- other")
    expect(blocks).toEqual([
      {
        type: "list", ordered: true, start: 3, items: [
          [{ type: "paragraph", children: [{ type: "text", text: "first" }] }],
          [
            { type: "paragraph", children: [{ type: "text", text: "second" }] },
            { type: "list", ordered: false, start: 1, items: [[{ type: "paragraph", children: [{ type: "text", text: "inner" }] }]] },
          ],
        ],
      },
      { type: "list", ordered: false, start: 1, items: [[{ type: "paragraph", children: [{ type: "text", text: "other" }] }]] },
    ])
  })

  it("reads a quote and a rule", () => {
    expect(parseMarkdown("> quoted\n\n---").blocks).toEqual([
      { type: "quote", children: [{ type: "paragraph", children: [{ type: "text", text: "quoted" }] }] },
      { type: "rule" },
    ])
  })
})

describe("parseInline", () => {
  it("reads strong, emphasis, code and links", () => {
    expect(parseInline("a **b** *c* `d_e` [f](https://example.org) [g](#/terms)")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "em", children: [{ type: "text", text: "c" }] },
      { type: "text", text: " " },
      { type: "code", text: "d_e" },
      { type: "text", text: " " },
      { type: "link", href: "https://example.org", children: [{ type: "text", text: "f" }] },
      { type: "text", text: " " },
      { type: "link", href: "#/terms", children: [{ type: "text", text: "g" }] },
    ])
  })

  it("keeps a bracketed slot, an underscore name and an escaped character as text", () => {
    expect(parseInline("**[TODO: contact email]**")).toEqual([{ type: "strong", children: [{ type: "text", text: "[TODO: contact email]" }] }])
    expect(parseInline("VITE_GEOBLOCK_CACHE_DAYS")).toEqual([{ type: "text", text: "VITE_GEOBLOCK_CACHE_DAYS" }])
    expect(parseInline("2 \\* 3")).toEqual([{ type: "text", text: "2 * 3" }])
  })

  it("does not make a link of an address it does not allow", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ type: "text", text: "[x](javascript:alert(1))" }])
    expect(parseInline("[x](/relative)")).toEqual([{ type: "text", text: "[x](/relative)" }])
  })
})

describe("isSafeHref", () => {
  it("allows in-app routes and absolute http, https and mailto addresses only", () => {
    expect(["#/terms", "https://example.org/a", "http://example.org", "mailto:a@example.org"].every(isSafeHref)).toBe(true)
    expect(["javascript:alert(1)", "data:text/html,x", "//example.org", "terms", "#anchor", "vbscript:x"].some(isSafeHref)).toBe(false)
  })
})
