import { lazy, useEffect, useRef, type ReactNode } from "react"
import { HashRouter, Routes, Route } from "react-router-dom"
import { useAccount, useDisconnect } from "wagmi"
import { Layout } from "@/components/layout/Layout"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Toaster } from "@/components/ui/toaster"
import { RestrictedScreen } from "@/components/RestrictedScreen"
import { Button } from "@/components/ui/button"
import type { Restriction } from "@/lib/restriction"
import { Analytics } from "@/components/Analytics"
import { useAutoConnect } from "@/hooks/useAutoConnect"
import { useSanctionsCheck } from "@/hooks/useSanctionsCheck"
import { useGeoblockCheck } from "@/hooks/useGeoblockCheck"
import { useWalletSanctionsCheck } from "@/hooks/useWalletSanctionsCheck"
import { useToast } from "@/hooks/useToast"
import Loader2 from "lucide-react/dist/esm/icons/loader-2"

const pageImports = {
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
  NotFound: () => import("@/pages/NotFoundPage")
    .then(m => ({ default: m.NotFoundPage })),
}

const OverviewPage = lazy(pageImports.Overview)
const DashboardPage = lazy(pageImports.Dashboard)
const ValidatorsPage = lazy(pageImports.Validators)
const ValidatorDetailPage = lazy(pageImports.ValidatorDetail)
const WithdrawalsPage = lazy(pageImports.Withdrawals)
const RewardsPage = lazy(pageImports.Rewards)
const NotFoundPage = lazy(pageImports.NotFound)

/** Preload all route chunks so IPFS-hosted builds are warm. */
function preloadAllRoutes() {
  for (const load of Object.values(pageImports)) {
    void load()
  }
}

function DisconnectWatcher() {
  const { isConnected } = useAccount()
  const wasConnected = useRef(false)
  const { toast } = useToast()

  useEffect(() => {
    if (isConnected) {
      wasConnected.current = true
    } else if (wasConnected.current) {
      wasConnected.current = false
      toast({
        variant: "info",
        title: "Wallet disconnected",
        description: "Please reconnect to continue.",
      })
    }
  }, [isConnected, toast])

  return null
}

function WalletSanctionsGate({ children }: { children: ReactNode }) {
  const { allowed, isLoading, restriction: reported, refetch } = useWalletSanctionsCheck()
  const { disconnect } = useDisconnect()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
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
            {restriction.reason === "unavailable" && <Button onClick={refetch}>Try again</Button>}
            <Button variant="outline" onClick={() => disconnect()}>Disconnect wallet</Button>
          </>
        }
      />
    )
  }

  return <>{children}</>
}

function App() {
  useAutoConnect()
  const sanctions = useSanctionsCheck()
  const geo = useGeoblockCheck()

  // Preload route chunks after first paint so they don't
  // compete with critical initial resources.
  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(preloadAllRoutes)
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(preloadAllRoutes, 1000)
    return () => clearTimeout(id)
  }, [])

  if (sanctions.isLoading || geo.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  if (!sanctions.allowed || !geo.allowed) {
    // When both gates refuse, the sanctions screening is named: it is checked first. Blocked
    // without a reason is still blocked: fail closed, and call it a failed check.
    const restriction: Restriction =
      (!sanctions.allowed && sanctions.restriction) ||
      (!geo.allowed && geo.restriction) ||
      (!sanctions.allowed ? { gate: "sanctionsApi", reason: "unavailable" } : { gate: "geoblock", reason: "unavailable" })
    return (
      <RestrictedScreen
        restriction={restriction}
        actions={
          restriction.reason === "unavailable" && (
            <Button onClick={() => window.location.reload()}>Reload</Button>
          )
        }
      />
    )
  }

  return (
    <HashRouter>
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
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </WalletSanctionsGate>
      <Toaster />
    </HashRouter>
  )
}

export default App
