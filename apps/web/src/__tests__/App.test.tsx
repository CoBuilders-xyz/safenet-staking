import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ToastProvider } from "@/hooks/ToastProvider"
import type { Restriction } from "@/lib/restriction"

/**
 * The legal pages open whatever the access checks would answer, and start none of them. Every
 * other route stays behind the checks. The checks are mocks that count their calls: a call is
 * the lookup starting.
 */
const gate = { allowed: false, isLoading: false, restriction: { gate: "geoblock", reason: "region", country: "CU" } as Restriction | undefined }
const useGeoblockCheck = vi.fn(() => gate)
const useSanctionsCheck = vi.fn(() => ({ allowed: true, isLoading: false }))
const useWalletSanctionsCheck = vi.fn(() => ({ allowed: true, isLoading: false, refetch: vi.fn() }))
const useAutoConnect = vi.fn()

vi.mock("@/hooks/useGeoblockCheck", () => ({ useGeoblockCheck: () => useGeoblockCheck() }))
vi.mock("@/hooks/useSanctionsCheck", () => ({ useSanctionsCheck: () => useSanctionsCheck() }))
vi.mock("@/hooks/useWalletSanctionsCheck", () => ({ useWalletSanctionsCheck: () => useWalletSanctionsCheck() }))
vi.mock("@/hooks/useAutoConnect", () => ({ useAutoConnect: (enabled?: boolean) => useAutoConnect(enabled) }))
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }))
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => <button>Connect Wallet</button> }))
vi.mock("@/components/WrongNetworkNotice", () => ({ WrongNetworkNotice: () => null }))
vi.mock("@/components/Analytics", () => ({ Analytics: () => null }))
vi.mock("@/pages/OverviewPage", () => ({ OverviewPage: () => <h1>Network overview</h1> }))
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}))

async function renderAt(hash: string) {
  window.location.hash = hash
  const { default: App } = await import("@/App")
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn())
  for (const mock of [useGeoblockCheck, useSanctionsCheck, useWalletSanctionsCheck, useAutoConnect]) mock.mockClear()
  gate.allowed = false
  gate.restriction = { gate: "geoblock", reason: "region", country: "CU" }
})

describe("App, the legal pages and the access checks", () => {
  it.each([
    ["#/imprint", "Imprint"],
    ["#/terms", "Terms of use"],
    ["#/privacy", "Privacy policy"],
    ["#/faq", "Frequently asked questions"],
  ])("opens %s for a blocked visitor without starting a check", async (hash, title) => {
    await renderAt(hash)

    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Access Restricted" })).toBeNull()
    expect(useGeoblockCheck).not.toHaveBeenCalled()
    expect(useSanctionsCheck).not.toHaveBeenCalled()
    expect(useWalletSanctionsCheck).not.toHaveBeenCalled()
    expect(useAutoConnect).toHaveBeenCalledWith(false)
    expect(useAutoConnect).not.toHaveBeenCalledWith(true)
    // No way into the interface but the link back, and no wallet control.
    expect(screen.queryByRole("link", { name: "My stake" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull()
  })

  it("keeps every other route closed for that visitor, and links the legal pages from the restricted screen", async () => {
    await renderAt("#/")

    expect(await screen.findByRole("heading", { name: "Access Restricted" })).toBeInTheDocument()
    expect(useGeoblockCheck).toHaveBeenCalled()
    expect(screen.queryByRole("heading", { name: "Network overview" })).toBeNull()

    await userEvent.click(screen.getByRole("link", { name: "Privacy" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Privacy policy" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Access Restricted" })).toBeNull()
  })

  it("closes again when the blocked visitor leaves a legal page for the interface", async () => {
    await renderAt("#/terms")
    await screen.findByRole("heading", { level: 1, name: "Terms of use" })
    expect(useGeoblockCheck).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("link", { name: "Back to Overview" }))
    expect(await screen.findByRole("heading", { name: "Access Restricted" })).toBeInTheDocument()
    expect(useGeoblockCheck).toHaveBeenCalled()
    expect(screen.queryByRole("heading", { name: "Network overview" })).toBeNull()
  })

  it("does not open an unknown route or a path under a legal page without the checks", async () => {
    await renderAt("#/terms/more")

    expect(await screen.findByRole("heading", { name: "Access Restricted" })).toBeInTheDocument()
    expect(useGeoblockCheck).toHaveBeenCalled()
  })

  it("opens the interface for an allowed visitor, with the checks run", async () => {
    gate.allowed = true
    gate.restriction = undefined
    await renderAt("#/")

    expect(await screen.findByRole("heading", { name: "Network overview" })).toBeInTheDocument()
    expect(useGeoblockCheck).toHaveBeenCalled()
    expect(useAutoConnect).toHaveBeenCalledWith(true)
  })
})
