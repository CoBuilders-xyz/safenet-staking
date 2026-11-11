import { CONTENT_PAGES } from "@/config/legal"

/** Preloaded beside the first page so its tooltip provider adds no later network round trip. */
export const routeContentImport = () => import("@/components/layout/RouteContent")

/** Each route's page, loaded on demand. */
export const pageImports = {
  Overview: () => import("@/pages/OverviewPage")
    .then(m => ({ default: m.OverviewPage })),
  Dashboard: () => import("@/pages/DashboardPage")
    .then(m => ({ default: m.DashboardPage })),
  Validators: () => import("@/pages/ValidatorsPage")
    .then(m => ({ default: m.ValidatorsPage })),
  ValidatorDetail: () => import("@/pages/ValidatorDetailPage")
    .then(m => ({ default: m.ValidatorDetailPage })),
  Withdrawals: () => import("@/pages/WithdrawalsPage")
    .then(m => ({ default: m.WithdrawalsPage })),
  Rewards: () => import("@/pages/RewardsPage")
    .then(m => ({ default: m.RewardsPage })),
  Alerts: () => import("@/pages/AlertsPage").then(m => ({ default: m.AlertsPage })),
  Content: () => import("@/pages/ContentPage")
    .then(m => ({ default: m.ContentPage })),
  NotFound: () => import("@/pages/NotFoundPage")
    .then(m => ({ default: m.NotFoundPage })),
}

/** The chunk of the route a hash URL opens, as `HashRouter` will match it. */
export function routeImportFor(hash: string): () => Promise<unknown> {
  const path = hash.replace(/^#/, "").split("?")[0] || "/"
  if (path === "/") return pageImports.Overview
  if (path === "/dashboard") return pageImports.Dashboard
  if (path === "/validators") return pageImports.Validators
  if (/^\/validators\/[^/]+$/.test(path)) return pageImports.ValidatorDetail
  if (path === "/withdrawals") return pageImports.Withdrawals
  if (path === "/rewards") return pageImports.Rewards
  if (path === "/alerts") return pageImports.Alerts
  if (CONTENT_PAGES.some(name => path === `/${name}`)) return pageImports.Content
  return pageImports.NotFound
}
