import { useEffect, useRef } from "react"
import { useConnect, useReconnect } from "wagmi"
import { isSafeApp } from "@/lib/safe"

/**
 * Auto-connects to the Safe wallet when loaded inside a Safe App iframe.
 * Falls back to wagmi's reconnect (restoring the last used wallet) otherwise.
 *
 * This replaces wagmi's built-in reconnectOnMount so that Safe Apps always
 * connect to the Safe connector instead of whichever wallet was last used.
 *
 * It connects once, the first time `enabled` is true: the legal pages pass false, so opening one
 * of them contacts no wallet.
 *
 * A wallet connects only under the Terms of use the visitor accepted (`termsAccepted`). Outside
 * Safe, a session is restored only when they were already accepted; otherwise the visitor
 * connects by hand, through the dialog that asks. Inside Safe, where nothing is clicked to
 * connect, the connection waits for the acceptance.
 */
export function useAutoConnect(enabled = true, termsAccepted = true) {
  const { connect, connectors } = useConnect()
  const { reconnect } = useReconnect()
  const hasAttempted = useRef(false)

  useEffect(() => {
    if (!enabled || hasAttempted.current) return
    if (isSafeApp && !termsAccepted) return
    hasAttempted.current = true
    if (!termsAccepted) return

    if (isSafeApp) {
      const connector = connectors.find((c) => c.id === "safe")
      if (connector) {
        connect({ connector })
        return
      }
    }

    // Outside Safe context, restore previous wallet session
    reconnect()
  }, [enabled, termsAccepted, connect, connectors, reconnect])
}
