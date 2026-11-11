/**
 * A parser for the Markdown subset the in-app pages are written in (`src/content`). It returns a
 * tree, which `Markdown` renders as React elements: no HTML string exists at any point, so text
 * that looks like a tag is shown as text. `src/content/README.md` lists the subset for authors.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; children: Block[] }
  | { type: "rule" }

export interface MarkdownDocument {
  /** The `key: value` lines between two `---` lines at the top of the file. */
  meta: Record<string, string>
  blocks: Block[]
}

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"])

/** In-app routes as `#/path`, and absolute http, https and mailto addresses. Nothing else is a link. */
export function isSafeHref(href: string): boolean {
  if (/^#\/[\w/-]*$/.test(href)) return true
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol)
  } catch {
    return false
  }
}

// One alternative per construct, tried in this order at each position: an escaped character,
// `code`, **strong**, *emphasis*, [label](address).
const INLINE = /\\([\\`*_[\]()#>.!-])|`([^`]+)`|\*\*(.+?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = []
  const text = (value: string) => {
    if (!value) return
    const last = nodes[nodes.length - 1]
    if (last?.type === "text") last.text += value
    else nodes.push({ type: "text", text: value })
  }
  let position = 0
  for (const match of source.matchAll(INLINE)) {
    text(source.slice(position, match.index))
    position = match.index + match[0].length
    const [whole, escaped, code, strong, em, label, href] = match
    if (escaped !== undefined) text(escaped)
    else if (code !== undefined) nodes.push({ type: "code", text: code })
    else if (strong !== undefined) nodes.push({ type: "strong", children: parseInline(strong) })
    else if (em !== undefined) nodes.push({ type: "em", children: parseInline(em) })
    else if (label !== undefined && href !== undefined && isSafeHref(href)) nodes.push({ type: "link", href, children: parseInline(label) })
    // An address that is not allowed stays visible as written, so the author sees it.
    else text(whole)
  }
  text(source.slice(position))
  return nodes
}

const HEADING = /^(#{1,4})\s+(.+)$/
const RULE = /^(?:-{3,}|\*{3,})$/
const QUOTE = /^>\s?(.*)$/
const LIST_ITEM = /^(\s*)([-*]|(\d+)\.)\s+(.*)$/

const indentOf = (line: string) => line.length - line.trimStart().length

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed === "") {
      i++
      continue
    }
    const heading = HEADING.exec(trimmed)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4, children: parseInline(heading[2]!.trim()) })
      i++
      continue
    }
    if (RULE.test(trimmed)) {
      blocks.push({ type: "rule" })
      i++
      continue
    }
    if (QUOTE.test(trimmed)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!.trim())) {
        quoted.push(QUOTE.exec(lines[i]!.trim())![1]!)
        i++
      }
      blocks.push({ type: "quote", children: parseBlocks(quoted) })
      continue
    }
    const first = LIST_ITEM.exec(line)
    if (first) {
      const indent = first[1]!.length
      const ordered = first[3] !== undefined
      const items: Block[][] = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i]!)
        if (!item || item[1]!.length !== indent || (item[3] !== undefined) !== ordered) break
        // The item's own text, then every following line indented under it: more text or a nested list.
        const body = [item[4]!]
        i++
        while (i < lines.length) {
          const next = lines[i]!
          if (next.trim() === "") {
            // A blank line stays in the item only when an indented line follows it.
            const after = lines.slice(i + 1).find((l) => l.trim() !== "")
            if (after === undefined || indentOf(after) <= indent) break
          } else if (indentOf(next) <= indent) {
            break
          }
          body.push(next)
          i++
        }
        const inner = body.slice(1).filter((l) => l.trim() !== "")
        const strip = inner.length ? Math.min(...inner.map(indentOf)) : 0
        items.push(parseBlocks([body[0]!, ...body.slice(1).map((l) => l.slice(Math.min(strip, indentOf(l))))]))
      }
      blocks.push({ type: "list", ordered, start: ordered ? Number(first[3]) : 1, items })
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i]!
      const text = current.trim()
      if (text === "" || (paragraph.length > 0 && (HEADING.test(text) || RULE.test(text) || QUOTE.test(text) || LIST_ITEM.test(current)))) break
      paragraph.push(text)
      i++
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) })
  }
  return blocks
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const meta: Record<string, string> = {}
  let start = 0
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const pair = /^([\w-]+):\s*(.*)$/.exec(line.trim())
        if (pair) meta[pair[1]!] = pair[2]!
      }
      start = end + 1
    }
  }
  return { meta, blocks: parseBlocks(lines.slice(start)) }
}
