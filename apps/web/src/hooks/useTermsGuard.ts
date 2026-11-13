import { useEffect } from "react"
import { useConnections, useDisconnect } from "wagmi"

/**
 * A wallet can connect without the Connect button: it announces an account when the visitor
 * connects the site from inside the wallet. Without accepted terms every such connection is
 * dropped, so the only way in is the button, which asks for them first.
 *
 * Every connection, not only the current one: one wallet can be registered twice, as the browser
 * wallet and through EIP-6963 discovery, and wagmi falls back to the one that is left.
 */
export function useTermsGuard(termsAccepted: boolean): void {
  const connections = useConnections()
  const { disconnect } = useDisconnect()

  useEffect(() => {
    if (termsAccepted) return
    for (const { connector } of connections) disconnect({ connector })
  }, [connections, termsAccepted, disconnect])
}
