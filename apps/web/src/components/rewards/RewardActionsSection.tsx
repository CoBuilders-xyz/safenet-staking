import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { useRewards } from "@/hooks/useRewards"
import { RewardsSection, SectionNote } from "./RewardsSection"

interface RewardActionsSectionProps {
  isConnected: boolean
  wrongNetwork: boolean
  rewards: ReturnType<typeof useRewards>
  onClaim: () => void
}

/** Why Claim is unavailable, in the order a user would fix it. Undefined when it is available. */
function claimBlocker({ isConnected, wrongNetwork, rewards }: Omit<RewardActionsSectionProps, "onClaim">) {
  if (!isConnected) return "Connect a wallet to claim."
  if (wrongNetwork) return "Your wallet is on another network. Switch to Ethereum to claim."
  if (rewards.error) return "Claiming needs your reward data, which did not load."
  if (rewards.isLoading) return undefined
  if (rewards.proof === null) return "This address has nothing to claim."
  if (rewards.data.rootStale) {
    return "Your reward file was built for a different Merkle root than the one on chain. Claiming opens when they match."
  }
  if (!rewards.data.canClaim) return "Nothing to claim right now."
  return undefined
}

export function RewardActionsSection(props: RewardActionsSectionProps) {
  const { rewards, onClaim } = props
  const blocker = claimBlocker(props)
  const claimDisabled = blocker !== undefined || rewards.isLoading || !rewards.data.canClaim

  return (
    <RewardsSection
      title="Actions"
      source="Claiming sends a transaction to the MerkleDrop contract on Ethereum."
    >
      <div className="flex flex-wrap gap-3">
        {/* Primary slot, reserved for the guided Claim & Stake flow. */}
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button fires no pointer events, so the wrapper carries the tooltip. */}
            <span tabIndex={0} className="inline-flex">
              <Button variant="gradient" disabled>
                Claim &amp; Stake
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming soon</TooltipContent>
        </Tooltip>
        <Button variant="outline" disabled={claimDisabled} onClick={onClaim}>
          Claim
        </Button>
      </div>
      {blocker && <SectionNote>{blocker}</SectionNote>}
    </RewardsSection>
  )
}
