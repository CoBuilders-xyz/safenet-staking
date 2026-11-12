import { i18n } from "@/i18n"
import { lazy, useEffect, useRef, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { HashRouter, Routes, Route, useLocation } from "react-router-dom"
import { useAccount, useDisconnect } from "wagmi"
import { Layout } from "@/components/layout/Layout"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Toaster } from "@/components/ui/toaster"
import { RestrictedScreen } from "@/components/RestrictedScreen"
import { Button } from "@/components/ui/button"
import { chooseRestriction, type Restriction } from "@/lib/restriction"
import { Analytics } from "@/components/Analytics"
import { useAutoConnect } from "@/hooks/useAutoConnect"
import { useSanctionsCheck } from "@/hooks/useSanctionsCheck"
import { useGeoblockCheck } from "@/hooks/useGeoblockCheck"
import { useWalletSanctionsCheck } from "@/hooks/useWalletSanctionsCheck"
import { useToast } from "@/hooks/useToast"
import { pageImports, routeImportFor, routeContentImport } from "@/routes"
import { CONTENT_PAGES, contentPageAt } from "@/config/legal"
import Loader2 from "lucide-react/dist/esm/icons/loader-2"

// The first page's code loads while the gates are still answering, rather than after them.
// Only code: nothing renders until every gate is open.
void routeImportFor(window.location.hash)()
void routeContentImport()

const OverviewPage = lazy(pageImports.Overview)
const DashboardPage = lazy(pageImports.Dashboard)
const ValidatorsPage = lazy(pageImports.Validators)
const ValidatorDetailPage = lazy(pageImports.ValidatorDetail)
const WithdrawalsPage = lazy(pageImports.Withdrawals)
const RewardsPage = lazy(pageImports.Rewards)
const AlertsPage = lazy(pageImports.Alerts)
const ContentPage = lazy(pageImports.Content)
const NotFoundPage = lazy(pageImports.NotFound)

/** Preload all route chunks so IPFS-hosted builds are warm. */
function preloadAllRoutes() {
  for (const load of Object.values(pageImports)) {
    void load()
  }
}

/**
 * Three seconds after the page has loaded, when the browser is idle, so the other routes never
 * compete with the first one for the network or the main thread. The `load` event alone comes too
 * early: it fires once the entry script has run, before the first page has drawn.
 */
const PRELOAD_AFTER_LOAD_MS = 3_000

function preloadWhenIdle(): () => void {
  let cancel = () => {}
  const whenIdle = () => {
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(preloadAllRoutes, { timeout: 5_000 })
      cancel = () => cancelIdleCallback(id)
    } else {
      preloadAllRoutes()
    }
  }
  const schedule = () => {
    const id = setTimeout(whenIdle, PRELOAD_AFTER_LOAD_MS)
    cancel = () => clearTimeout(id)
  }
  if (document.readyState === "complete") {
    schedule()
  } else {
    window.addEventListener("load", schedule, { once: true })
    cancel = () => window.removeEventListener("load", schedule)
  }
  return () => cancel()
}

function DisconnectWatcher() {
  const { isConnected } = useAccount()
  const wasConnected = useRef(false)
  const { toast } = useToast()
  const { t } = useTranslation()

  useEffect(() => {
    if (isConnected) {
      wasConnected.current = true
    } else if (wasConnected.current) {
      wasConnected.current = false
      toast({
        variant: "info",
        title: t("shell.disconnected.title", "Wallet disconnected"),
        description: t("shell.disconnected.description", "Please reconnect to continue."),
      })
    }
  }, [isConnected, toast, t])

  return null
}

function WalletSanctionsGate({ children }: { children: ReactNode }) {
  const { allowed, isLoading, restriction: reported, refetch } = useWalletSanctionsCheck()
  const { disconnect } = useDisconnect()
  useTranslation()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{i18n.t("onboarding.checkingAccess", "Checking access…")}</span>
      </div>
    )
  }

  if (!allowed) {
    // Blocked without a reason is still blocked: fail closed, and call it a failed check.
    const restriction: Restriction = reported ?? { gate: "walletSanctions", reason: "unavailable" }
    return (
      <RestrictedScreen
        restriction={restriction}
        actions={
          <>
            {restriction.reason === "unavailable" && <Button onClick={refetch}>{i18n.t("onboarding.tryAgain", "Try again")}</Button>}
            <Button variant="outline" onClick={() => disconnect()}>{i18n.t("onboarding.disconnectWallet", "Disconnect wallet")}</Button>
          </>
        }
      />
    )
  }

  return <>{children}</>
}

/** Every page but the legal ones: closed until each access check has answered and allowed. */
function GatedApp() {
  useTranslation()
  const sanctions = useSanctionsCheck()
  const geo = useGeoblockCheck()

  if (sanctions.isLoading || geo.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{i18n.t("onboarding.checkingAccess", "Checking access…")}</span>
      </div>
    )
  }

  // Sanctions screening is checked first. A refusal is named before a failed check.
  const restriction = chooseRestriction([
    { gate: "sanctionsApi", ...sanctions },
    { gate: "geoblock", ...geo },
  ])
  if (restriction) {
    return (
      <RestrictedScreen
        restriction={restriction}
        actions={
          restriction.reason === "unavailable" && (
            <Button onClick={() => window.location.reload()}>{i18n.t("onboarding.reload", "Reload")}</Button>
          )
        }
      />
    )
  }

  return (
    <>
      <Analytics />
      <DisconnectWatcher />
      <WalletSanctionsGate>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<ErrorBoundary><OverviewPage /></ErrorBoundary>} />
            <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
            <Route path="/validators" element={<ErrorBoundary><ValidatorsPage /></ErrorBoundary>} />
            <Route path="/validators/:address" element={<ErrorBoundary><ValidatorDetailPage /></ErrorBoundary>} />
            <Route path="/withdrawals" element={<ErrorBoundary><WithdrawalsPage /></ErrorBoundary>} />
            <Route path="/rewards" element={<ErrorBoundary><RewardsPage /></ErrorBoundary>} />
            <Route path="/alerts" element={<ErrorBoundary><AlertsPage /></ErrorBoundary>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </WalletSanctionsGate>
    </>
  )
}

/**
 * The imprint, the terms, the privacy policy and the FAQ. A visitor must be able to read them
 * whatever the access checks would answer, so they render outside the gates and start none of
 * them: no country lookup, no sanctions request and no wallet.
 */
function OpenPages() {
  return (
    <Routes>
      <Route element={<Layout standalone />}>
        {CONTENT_PAGES.map(name => (
          <Route key={name} path={`/${name}`} element={<ErrorBoundary><ContentPage name={name} /></ErrorBoundary>} />
        ))}
      </Route>
    </Routes>
  )
}

/** Chooses by the route alone, before any check runs: a legal page, or the gated interface. */
function Shell() {
  const { pathname } = useLocation()
  const open = contentPageAt(pathname) !== undefined
  useAutoConnect(!open)
  return open ? <OpenPages /> : <GatedApp />
}

function App() {
  useTranslation()
  useEffect(() => preloadWhenIdle(), [])

  return (
    <HashRouter>
      <Shell />
      <Toaster />
    </HashRouter>
  )
}

export default App
