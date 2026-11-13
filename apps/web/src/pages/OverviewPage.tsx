import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { LegalLink } from "@/components/LegalLink"
import { HistoryChart } from "@/components/overview/HistoryCharts"
import { PageHero } from "@/components/PageHero"
import { Term } from "@/components/ui/term"
import { Button } from "@/components/ui/button"
import { SectionBoundary } from "@/components/overview/OverviewSection"
import {
  ActivityPanel,
  DistributionPanel,
  FreshnessPanel,
  HeadlineStats,
  RewardsPanel,
  ValidatorsPanel,
} from "@/components/overview/OverviewSections"

/**
 * The state of Safenet, with no wallet. Each section reads its own data and sits in its own
 * error boundary, so one failing source leaves the others on screen.
 */
export function OverviewPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <PageHero
        title={t("overview.hero.title", "Network overview")}
        subtitle={<Trans i18nKey="onboarding.hero.overview" defaults="The state of <network>Safenet</network> <staking>staking</staking> and consensus. No wallet needed." components={{ network: <Term term="safenet" children={null} />, staking: <Term term="staking" children={null} /> }} />}
      >
        <Button asChild variant="outline" className="mt-6">
          <Link to="/dashboard">{t("overview.hero.openDashboard", "Manage my stake")}</Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("dashboard.rewardsAreNotGuaranteedAndMayVary", "Rewards are not guaranteed and may vary.")}{" "}
          <LegalLink page="terms" className="underline hover:text-foreground transition-colors">{t("overview.hero.seeTerms", "See Terms.")}</LegalLink>
        </p>
      </PageHero>
      <SectionBoundary title={t("overview.freshness.title", "Data freshness")}>
        <FreshnessPanel />
      </SectionBoundary>
      <SectionBoundary title={t("overview.headline.title", "Headline figures")}>
        <HeadlineStats />
      </SectionBoundary>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary title={t("overview.distribution.title", "Stake distribution")}>
          <DistributionPanel />
        </SectionBoundary>
        <SectionBoundary title={t("overview.rewards.title", "Rewards")}>
          <RewardsPanel />
        </SectionBoundary>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary title={t("overview.charts.stake", "Total SAFE staked over time")}><HistoryChart kind="stake" /></SectionBoundary>
        <SectionBoundary title={t("overview.charts.attestations", "Attestations per day")}><HistoryChart kind="attestations" /></SectionBoundary>
      </div>
      <SectionBoundary title={t("overview.validators.title", "Validators")}>
        <ValidatorsPanel />
      </SectionBoundary>
      <SectionBoundary title={t("overview.activity.boundaryTitle", "Recent activity")}>
        <ActivityPanel />
      </SectionBoundary>
    </div>
  )
}
