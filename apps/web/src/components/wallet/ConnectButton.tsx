import { useTranslation } from "react-i18next"
import { lazy, Suspense, useRef, useState, useEffect, useCallback } from "react"
import { useAccount, useConnect, useDisconnect } from "wagmi"
import { Button } from "@/components/ui/button"
import { truncateAddress, formatTokenAmount } from "@/lib/format"
import { activeChain } from "@/config/chains"
import { useTokenBalance } from "@/hooks/useTokenBalance"
import { useNetworkSwitch } from "@/hooks/useNetworkSwitch"
import { useToast } from "@/hooks/useToast"
import { copyToClipboard } from "@/lib/clipboard"
import Copy from "lucide-react/dist/esm/icons/copy"
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right"
import { SafeTokenBadge } from "@/components/ui/SafeTokenBadge"
import { isSafeApp } from "@/lib/safe"
import { acceptTerms, useTermsAccepted } from "@/lib/termsAcceptance"

// Radix's dialog stays out of the entry bundle: it loads when a visitor is first asked.
const TermsDialog = lazy(() => import("./TermsDialog"))

function ConnectWalletButton({ onClick, ref: buttonRef, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> }) {
  const { t } = useTranslation()
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className="flex shrink-0 items-center gap-3 whitespace-nowrap rounded-md bg-primary text-primary-foreground text-sm font-medium uppercase tracking-wide pl-3 pr-2 py-2 h-10 transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      {...props}
    >
      <span>{t("wallet.connectWallet", "Connect Wallet")}</span>
      <span className="flex items-center justify-center w-6 h-6 shrink-0 rounded-sm border border-primary-foreground/50">
        <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
      </span>
    </button>
  )
}

export function ConnectButton() {
  const { t } = useTranslation()
  const hasInjectedWallet = typeof window.ethereum !== "undefined"
  const { address, isConnected } = useAccount()
  const { connect: rawConnect, connectors: allConnectors } = useConnect()
  const connectors = allConnectors.filter((c) => {
    if (c.id === "browserWallet") return hasInjectedWallet
    if (c.id === "walletConnect") return true
    return false
  })
  const { disconnect, disconnectAsync } = useDisconnect()
  const { wrongNetwork, canSwitch, switchToActive } = useNetworkSwitch()
  const { data: balance } = useTokenBalance()
  const { toast } = useToast()
  const termsAccepted = useTermsAccepted()
  // What the visitor asked for before agreeing to the terms; it runs once they agree.
  const [afterTerms, setAfterTerms] = useState<(() => void) | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const connect: typeof rawConnect = useCallback(
    (variables, options) => {
      rawConnect(variables, {
        ...options,
        async onError(error) {
          if (/already connected/i.test(error.message)) {
            await disconnectAsync()
            rawConnect(variables, options)
            return
          }
          toast({
            variant: "error",
            title: t("wallet.connectionFailed", "Connection failed"),
            description: t("wallet.connectionHelp", "Could not connect to your wallet. Open it and try again."),
          })
          options?.onError?.(error, variables, undefined, undefined as never)
        },
      })
    },
    [rawConnect, toast, t, disconnectAsync],
  )

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  // Auto-focus first item on open
  useEffect(() => {
    if (menuOpen && itemRefs.current[0]) {
      itemRefs.current[0].focus()
    }
  }, [menuOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!menuOpen) return

      if (e.key === "Escape") {
        e.preventDefault()
        setMenuOpen(false)
        triggerRef.current?.focus()
        return
      }

      const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)

      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[next]?.focus()
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        items[prev]?.focus()
      }
    },
    [menuOpen],
  )

  if (!isConnected) {
    // In iframe, Safe auto-connect handles connection — no button needed. It waits for the terms
    // to be accepted (useAutoConnect), so until then the button is what asks for them.
    if (isSafeApp && termsAccepted) return null

    /** Runs `action` under accepted terms: at once, or after the dialog that asks for them. */
    const underTerms = (action: () => void) => {
      if (termsAccepted) action()
      else setAfterTerms(() => action)
    }
    // The dialog has no trigger of its own to give focus back to, so the button takes it.
    const focusButton = () => requestAnimationFrame(() => triggerRef.current?.focus())
    const opensMenu = !isSafeApp && connectors.length > 1
    const termsDialog = afterTerms && (
      <Suspense fallback={null}>
        <TermsDialog
          open
          onCancel={() => {
            setAfterTerms(null)
            focusButton()
          }}
          onAccept={() => {
            const action = afterTerms
            setAfterTerms(null)
            acceptTerms()
            action()
            // The wallet menu, when it opens next, takes focus to its first item itself.
            if (!opensMenu) focusButton()
          }}
        />
      </Suspense>
    )

    if (isSafeApp) {
      // Accepting is all it takes here: the Safe connector then connects by itself.
      return (
        <>
          <ConnectWalletButton ref={triggerRef} onClick={() => underTerms(() => {})} />
          {termsDialog}
        </>
      )
    }

    // Single connector: connect directly without menu
    if (connectors.length === 1) {
      return (
        <>
          <ConnectWalletButton ref={triggerRef} onClick={() => underTerms(() => connect({ connector: connectors[0] }))} />
          {termsDialog}
        </>
      )
    }

    return (
      <div className="relative" ref={menuRef} role="none" onKeyDown={handleKeyDown}>
        <ConnectWalletButton
          ref={triggerRef}
          onClick={() => (menuOpen ? setMenuOpen(false) : underTerms(() => setMenuOpen(true)))}
          aria-haspopup="true"
          aria-expanded={menuOpen}
        />
        {termsDialog}
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-popover text-popover-foreground p-2 shadow-lg z-50"
            role="menu"
          >
            {connectors.map((connector, i) => (
              <button
                key={connector.uid}
                ref={(el) => { itemRefs.current[i] = el }}
                role="menuitem"
                tabIndex={-1}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none transition-colors text-left"
                onClick={() => {
                  setMenuOpen(false)
                  connect({ connector })
                }}
              >
                {connector.icon && (
                  <img src={connector.icon} alt="" className="h-5 w-5 shrink-0 rounded" aria-hidden="true" />
                )}
                {connector.id === "browserWallet" ? t("wallet.browserWallet", "Browser Wallet") : connector.name}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (wrongNetwork) {
    return canSwitch ? (
      <Button variant="destructive" onClick={switchToActive}>
        {t("wallet.switchTo", "Switch to {{name}}", { name: activeChain.name })}
      </Button>
    ) : (
      <span className="rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive">{t("onboarding.wrongNetwork", "Wrong network")}</span>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {balance !== undefined && (
        <span
          className="hidden lg:inline-flex items-center gap-3 h-8
            px-3 whitespace-nowrap rounded-md
            bg-card
            border border-input"
        >
          <span className="text-base font-mono font-medium tabular-nums">
            {formatTokenAmount(typeof balance === "bigint" ? balance : 0n, 18, 0)}
          </span>
          <SafeTokenBadge />
        </span>
      )}
      <button
        className="flex items-center gap-1.5 text-sm font-mono bg-secondary px-3 py-1.5 rounded-md hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={async () => {
          if (!address) return
          const ok = await copyToClipboard(address)
          if (ok) toast({ variant: "success", title: t("validators.addressCopied", "Address copied") })
        }}
        title={t("validators.copyAddress", "Copy address")}
      >
        {truncateAddress(address ?? "")}
        <Copy className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
      {!isSafeApp && (
        <Button variant="outline" size="sm" onClick={() => disconnect()}>{t("wallet.disconnect", "Disconnect")}</Button>
      )}
    </div>
  )
}
