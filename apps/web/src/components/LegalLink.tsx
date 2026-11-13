import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { LEGAL_URL_OVERRIDES, type ContentPageName } from "@/config/legal"

interface LegalLinkProps {
  page: ContentPageName
  className?: string
  /** Open in a new tab, as from a dialog the visitor must not lose. */
  newTab?: boolean
  children?: ReactNode
}

/** A link to one of the in-app pages, or to the operator's own document when its URL is set. */
export function LegalLink({ page, className, newTab = false, children }: LegalLinkProps) {
  const override = LEGAL_URL_OVERRIDES[page]
  if (override) {
    return <a href={override} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
  }
  return (
    <Link to={`/${page}`} className={className} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </Link>
  )
}
