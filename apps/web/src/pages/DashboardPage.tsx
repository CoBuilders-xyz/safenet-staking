import { useTranslation } from "react-i18next"
import { StatsOverview } from "@/components/dashboard/StatsOverview"
import { QuickActions } from "@/components/dashboard/QuickActions"
import { StakingSection } from "@/components/dashboard/StakingSection"
import { StakeDistribution } from "@/components/dashboard/StakeDistribution"
import { PageHero } from "@/components/PageHero"

const termsUrl = import.meta.env.VITE_TERMS_URL as string | undefined

export function DashboardPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <PageHero
        title={t("dashboard.stakeYourSafe", "Stake your SAFE")}
        subtitle={t("dashboard.earnRewardsForHelpingSecureSafenet", "Earn rewards for helping secure Safenet")}
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
      <StatsOverview />
      <QuickActions />
      <StakingSection />
      <StakeDistribution />
    </div>
  )
}
