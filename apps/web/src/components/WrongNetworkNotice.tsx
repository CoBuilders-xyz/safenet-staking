import { useTranslation } from "react-i18next"
import { i18n } from "@/i18n"
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
  useTranslation()
  const { wrongNetwork, walletChainId, canSwitch, switchToActive, isSwitching, switchError } = useNetworkSwitch()
  if (!wrongNetwork) return null

  return (
    <section
      aria-labelledby="wrong-network-title"
      className="mb-6 space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"
    >
      <h2 id="wrong-network-title" className="text-base font-semibold">{i18n.t("onboarding.wrongNetwork", "Wrong network")}</h2>
      <p>{i18n.t("onboarding.networkDescription", "Your wallet is on another network (chain ID {{chainId}}). The figures here are read from {{network}} and stay current, but staking, unstaking and claiming are off until the wallet is on {{network}}.", { chainId: walletChainId, network: activeChain.name })}</p>
      {canSwitch ? (
        <Button variant="destructive" size="sm" onClick={switchToActive} disabled={isSwitching}>
          {isSwitching ? i18n.t("common.confirmInWallet", "Confirm in Wallet…") : i18n.t("wallet.switchTo", "Switch to {{name}}", { name: activeChain.name })}
        </Button>
      ) : (
        <p className="text-muted-foreground">
          {isSafeApp
            ? i18n.t("onboarding.safeNetwork", "This Safe is on another network. Open the app from a Safe on {{network}}.", { network: activeChain.name })
            : i18n.t("onboarding.manualNetwork", "This wallet cannot be switched from here. Switch it to {{network}} in the wallet itself.", { network: activeChain.name })}
        </p>
      )}
      {switchError && (
        <p role="alert" className="text-destructive">
          {i18n.t("onboarding.switchFailed", "The wallet did not switch. Switch it to {{network}} in the wallet itself.", { network: activeChain.name })}</p>
      )}
    </section>
  )
}
