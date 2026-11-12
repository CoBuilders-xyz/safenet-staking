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
 */
export function useAutoConnect(enabled = true) {
  const { connect, connectors } = useConnect()
  const { reconnect } = useReconnect()
  const hasAttempted = useRef(false)

  useEffect(() => {
    if (!enabled || hasAttempted.current) return
    hasAttempted.current = true

    if (isSafeApp) {
      const connector = connectors.find((c) => c.id === "safe")
      if (connector) {
        connect({ connector })
        return
      }
    }

    // Outside Safe context, restore previous wallet session
    reconnect()
  }, [enabled, connect, connectors, reconnect])
}
