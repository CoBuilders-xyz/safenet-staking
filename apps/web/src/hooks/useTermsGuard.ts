import { useEffect } from "react"
import { useAccount, useDisconnect } from "wagmi"

/**
 * A wallet can connect without the Connect button: it announces an account when the visitor
 * connects the site from inside the wallet. Without accepted terms that connection is dropped,
 * so the only way in is the button, which asks for them first.
 */
export function useTermsGuard(termsAccepted: boolean): void {
  const { isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  useEffect(() => {
    if (isConnected && !termsAccepted) disconnect()
  }, [isConnected, termsAccepted, disconnect])
}
