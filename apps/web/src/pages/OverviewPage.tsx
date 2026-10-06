import { Link } from "react-router-dom"
import { PageHero } from "@/components/PageHero"
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
 * The state of Safenet Beta, with no wallet. Each section reads its own data and sits in its own
 * error boundary, so one failing source leaves the others on screen.
 */
export function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHero
        title="Network overview"
        subtitle="The state of Safenet Beta staking and consensus. No wallet needed."
      >
        <Button asChild variant="outline" className="mt-6">
          <Link to="/dashboard">Open the staking dashboard</Link>
        </Button>
      </PageHero>
      <SectionBoundary title="Data freshness">
        <FreshnessPanel />
      </SectionBoundary>
      <SectionBoundary title="Headline figures">
        <HeadlineStats />
      </SectionBoundary>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionBoundary title="Stake distribution">
          <DistributionPanel />
        </SectionBoundary>
        <SectionBoundary title="Rewards">
          <RewardsPanel />
        </SectionBoundary>
      </div>
      <SectionBoundary title="Validators">
        <ValidatorsPanel />
      </SectionBoundary>
      <SectionBoundary title="Recent activity">
        <ActivityPanel />
      </SectionBoundary>
    </div>
  )
}
