import { useState } from "react"
import { useAccount } from "wagmi"
import { PageHero } from "@/components/PageHero"
import { ClaimRewardsDialog } from "@/components/dashboard/ClaimRewardsDialog"
import { YourRewardsSection } from "@/components/rewards/YourRewardsSection"
import { RewardActionsSection } from "@/components/rewards/RewardActionsSection"
import { ProgrammeSection } from "@/components/rewards/ProgrammeSection"
import { VerifiabilitySection } from "@/components/rewards/VerifiabilitySection"
import { useRewards } from "@/hooks/useRewards"
import { useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { useWrongNetwork } from "@/hooks/useWrongNetwork"

export function RewardsPage() {
  const { isConnected } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const rewards = useRewards()
  const programme = useProgrammeRewards()
  const [claimOpen, setClaimOpen] = useState(false)

  return (
    <div className="space-y-6">
      <PageHero
        title="Rewards"
        subtitle="Claim your Safenet Beta rewards and check them against the chain"
      />
      <div className="grid gap-6 md:grid-cols-2">
        <YourRewardsSection isConnected={isConnected} rewards={rewards} />
        <RewardActionsSection
          isConnected={isConnected}
          wrongNetwork={wrongNetwork}
          rewards={rewards}
          onClaim={() => setClaimOpen(true)}
        />
        <ProgrammeSection programme={programme} />
        <VerifiabilitySection programme={programme} />
      </div>
      {/* Always mounted, so a claim still confirming after the dialog closes still reports. */}
      <ClaimRewardsDialog open={claimOpen} onOpenChange={setClaimOpen} />
    </div>
  )
}
