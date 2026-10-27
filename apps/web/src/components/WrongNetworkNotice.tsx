import { Button } from "@/components/ui/button"
import { activeChain } from "@/config/chains"
import { useNetworkSwitch } from "@/hooks/useNetworkSwitch"
import { isSafeApp } from "@/lib/safe"

/**
 * Shown on every page while the wallet is on another network. Reads do not go through the wallet,
 * so the figures stay those of the configured chain; what stops is every transaction, and this
 * says so instead of leaving disabled buttons to explain themselves.
 */
export function WrongNetworkNotice() {
  const { wrongNetwork, walletChainId, canSwitch, switchToActive, isSwitching, switchError } = useNetworkSwitch()
  if (!wrongNetwork) return null

  return (
    <section
      aria-labelledby="wrong-network-title"
      className="mb-6 space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"
    >
      <h2 id="wrong-network-title" className="text-base font-semibold">Wrong network</h2>
      <p>
        Your wallet is on another network (chain ID {walletChainId}). The figures here are read from{" "}
        {activeChain.name} and stay current, but staking, unstaking and claiming are off until the wallet
        is on {activeChain.name}.
      </p>
      {canSwitch ? (
        <Button variant="destructive" size="sm" onClick={switchToActive} disabled={isSwitching}>
          {isSwitching ? "Confirm in Wallet…" : `Switch to ${activeChain.name}`}
        </Button>
      ) : (
        <p className="text-muted-foreground">
          {isSafeApp
            ? `This Safe is on another network. Open the app from a Safe on ${activeChain.name}.`
            : `This wallet cannot be switched from here. Switch it to ${activeChain.name} in the wallet itself.`}
        </p>
      )}
      {switchError && (
        <p role="alert" className="text-destructive">
          The wallet did not switch. Switch it to {activeChain.name} in the wallet itself.
        </p>
      )}
    </section>
  )
}
