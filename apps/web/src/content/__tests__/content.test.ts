import { describe, it, expect } from "vitest"
import { CONTENT_PAGES } from "@/config/legal"
import { isSafeHref, parseMarkdown } from "@/lib/markdown"

/**
 * Every Markdown file under src/content, checked against the subset the renderer supports
 * (README.md beside the files). Syntax outside it would show as plain text on the page, so a
 * replacement text that uses a table or an image fails here, with the file and the line.
 */
const files = import.meta.glob<string>("../*/*.md", { query: "?raw", import: "default", eager: true })

const UNSUPPORTED: [RegExp, string][] = [
  [/^\s*\|/, "a table"],
  [/!\[/, "an image"],
  [/<\/?[a-zA-Z][^>]*>/, "an HTML tag"],
  [/^\s*(```|~~~)/, "a fenced code block"],
  [/^\s*#{5,}/, "a heading below level 4"],
  [/^\s*=+\s*$/, "an underlined heading"],
  [/\[[^\]]+\]\[[^\]]*\]|\[\^/, "a reference link or a footnote"],
  [/( {2,}|\\)$/, "a line break inside a paragraph"],
]

function problems(path: string, source: string): string[] {
  const found: string[] = []
  const lines = source.split("\n")
  lines.forEach((line, index) => {
    const at = `${path}:${index + 1}`
    for (const [pattern, name] of UNSUPPORTED) {
      if (pattern.test(line)) found.push(`${at}: ${name} is not supported`)
    }
    for (const link of line.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (!isSafeHref(link[1]!)) found.push(`${at}: the address ${link[1]} is not allowed; use https, mailto or an in-app #/route`)
    }
  })
  const { meta, blocks } = parseMarkdown(source)
  const titles = blocks.filter((b) => b.type === "heading" && b.level === 1)
  if (titles.length !== 1 || blocks[0] !== titles[0]) found.push(`${path}: the text must open with its one level-1 heading`)
  for (const [key, value] of Object.entries(meta)) {
    if (key !== "status" || value !== "placeholder") found.push(`${path}: unknown front matter "${key}: ${value}"`)
  }
  return found
}

describe("the content files", () => {
  it("has an English text for every page", () => {
    expect(Object.keys(files).sort()).toEqual(CONTENT_PAGES.map((name) => `../en/${name}.md`).sort())
  })

  it.each(Object.entries(files))("%s uses only the supported subset", (path, source) => {
    expect(problems(path, source)).toEqual([])
  })

  it("reports what the renderer cannot show", () => {
    expect(problems("x.md", "Intro\n\n| a | b |\n\n<b>bold</b> ![i](https://example.org/i.png) [x](vbscript:run)\n\nStreet 1\\\nCity  \nCountry\n")).toEqual([
      "x.md:3: a table is not supported",
      "x.md:5: an image is not supported",
      "x.md:5: an HTML tag is not supported",
      "x.md:5: the address vbscript:run is not allowed; use https, mailto or an in-app #/route",
      "x.md:7: a line break inside a paragraph is not supported",
      "x.md:8: a line break inside a paragraph is not supported",
      "x.md: the text must open with its one level-1 heading",
    ])
  })
})
