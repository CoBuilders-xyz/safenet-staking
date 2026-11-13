import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { LEGAL_URL_OVERRIDES, contentPageAt } from "@/config/legal"
import type { Block, Inline } from "@/lib/markdown"

const linkClass = "underline underline-offset-2 hover:text-primary transition-colors"

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text
      case "code":
        return <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words">{node.text}</code>
      case "strong":
        return <strong key={index} className="font-semibold">{renderInline(node.children)}</strong>
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>
      case "link": {
        // `#/terms` is a route of this app. Every other address the parser lets through is absolute.
        const route = node.href.startsWith("#/") ? node.href.slice(1) : undefined
        // An operator's own document replaces the in-app page here too, as in every other link to it.
        const page = route === undefined ? undefined : contentPageAt(route)
        const href = (page && LEGAL_URL_OVERRIDES[page]) ?? (route === undefined ? node.href : undefined)
        return href === undefined ? (
          <Link key={index} to={route!} className={linkClass}>{renderInline(node.children)}</Link>
        ) : (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>{renderInline(node.children)}</a>
        )
      }
    }
  })
}

const headingClass = {
  1: "font-heading text-3xl font-semibold tracking-tight",
  2: "font-heading text-xl font-semibold tracking-tight pt-4",
  3: "text-base font-semibold pt-2",
  4: "text-sm font-semibold",
} as const

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as const
      return <Tag key={key} className={headingClass[block.level]}>{renderInline(block.children)}</Tag>
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children)}</p>
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="space-y-2">
          {/* An item's opening text sits on the marker's line; what follows it is laid out as blocks. */}
          {item.map((child, childIndex) =>
            childIndex === 0 && child.type === "paragraph" ? renderInline(child.children) : renderBlock(child, childIndex),
          )}
        </li>
      ))
      return block.ordered
        ? <ol key={key} start={block.start} className="list-decimal space-y-2 pl-6">{items}</ol>
        : <ul key={key} className="list-disc space-y-2 pl-6">{items}</ul>
    }
    case "quote":
      return <blockquote key={key} className="space-y-3 border-l-2 border-border pl-4 text-muted-foreground">{block.children.map(renderBlock)}</blockquote>
    case "rule":
      return <hr key={key} className="border-border" />
  }
}

/** Renders a parsed document. Content is built as elements, never set as HTML. */
export function Markdown({ blocks }: { blocks: Block[] }) {
  return <div className="space-y-4 leading-relaxed">{blocks.map(renderBlock)}</div>
}
