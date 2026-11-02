import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { useAccount, useConnect } from "wagmi"
import { StatsOverview } from "@/components/dashboard/StatsOverview"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { StakingSection } from "@/components/dashboard/StakingSection"
import { StakeDistribution } from "@/components/dashboard/StakeDistribution"
import { PageHero } from "@/components/PageHero"
import { Button } from "@/components/ui/button"
import { Term } from "@/components/ui/term"
import { ConnectButton } from "@/components/wallet/ConnectButton"
import { useToast } from "@/hooks/useToast"
import { isSafeApp } from "@/lib/safe"

const termsUrl = import.meta.env.VITE_TERMS_URL as string | undefined

/** My stake: the connected wallet's positions. With no wallet, the network figures live on the Overview. */
export function DashboardPage() {
  const { t } = useTranslation()
  const { isConnected } = useAccount()
  return (
    <div className="space-y-6">
      <PageHero
        title={t("dashboard.stakeYourSafe", "Stake your SAFE")}
        subtitle={<Trans i18nKey="onboarding.hero.dashboard" defaults="Earn <rewards>rewards</rewards> for helping secure <network>Safenet</network>" components={{ rewards: <Term term="rewards" children={null} />, network: <Term term="safenet" children={null} /> }} />}
      >
        <p className="mt-4 text-xs text-muted-foreground">
          {t("dashboard.rewardsAreNotGuaranteedAndMayVary", "Rewards are not guaranteed and may vary.")}{" "}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">{t("dashboard.seeTermsForDetails", "See terms for details.")}</a>
          ) : (
            t("dashboard.seeTermsForDetails", "See terms for details.")
          )}
        </p>
      </PageHero>
      {isConnected ? (
        <>
          <StatsOverview />
          <QuickActions />
          <StakingSection />
          <StakeDistribution />
        </>
      ) : (
        <section className="space-y-6 rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">{t("dashboard.connectToSeeYourStakes", "Connect your wallet to see your stakes, rewards, and positions")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isSafeApp ? <SafeConnectRetry /> : <ConnectButton />}
            <Button asChild variant="outline">
              <Link to="/validators">{t("dashboard.browseValidators", "Browse validators")}</Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * Inside a Safe App, ConnectButton renders nothing and useAutoConnect connects the Safe connector
 * once. If that attempt fails, this is the only way to try again without reloading.
 */
function SafeConnectRetry() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { connect, connectors, isPending } = useConnect()
  // isConnecting is wagmi's shared status, so it also covers the attempt useAutoConnect started.
  const { isConnecting } = useAccount()
  const safe = connectors.find((c) => c.id === "safe")
  if (!safe) return null
  return (
    <Button
      disabled={isPending || isConnecting}
      onClick={() => connect({ connector: safe }, {
        onError: () => toast({
          variant: "error",
          title: t("wallet.connectionFailed", "Connection failed"),
          description: t("wallet.connectionHelp", "Could not connect to your wallet. Open it and try again."),
        }),
      })}
    >
      {t("dashboard.connectSafe", "Connect Safe")}
    </Button>
  )
}
