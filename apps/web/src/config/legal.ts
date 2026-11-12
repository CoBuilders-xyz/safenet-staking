/** The company that operates this deployment. The footer names it; the Imprint has its details. */
export const OPERATOR_NAME = "Backstage Online LLC"

/** The in-app pages under `src/content`, each at `/#/<name>`. */
export const CONTENT_PAGES = ["imprint", "terms", "privacy", "faq"] as const
export type ContentPageName = (typeof CONTENT_PAGES)[number]

/**
 * The in-app page a router path opens, or undefined. As the router matches it: no case, and a
 * trailing slash allowed. These paths open without the access checks, so `App.tsx`, `routes.ts`
 * and the preconnect script in `index.html` must agree on them.
 */
export function contentPageAt(pathname: string): ContentPageName | undefined {
  const name = pathname.replace(/^\/+|\/+$/g, "").toLowerCase()
  return CONTENT_PAGES.find((page) => page === name)
}

/**
 * Another operator's own documents. A URL set here replaces the in-app page in every link to it.
 * An empty value, as in `.env.example`, is no override.
 */
export const LEGAL_URL_OVERRIDES: Partial<Record<ContentPageName, string>> = {
  terms: import.meta.env.VITE_TERMS_URL || undefined,
  privacy: import.meta.env.VITE_PRIVACY_URL || undefined,
  imprint: import.meta.env.VITE_IMPRINT_URL || undefined,
}
