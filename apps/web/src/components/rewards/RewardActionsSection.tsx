import { Button } from "@/components/ui/button"
import type { useRewards } from "@/hooks/useRewards"
import { RewardsSection, SectionNote } from "./RewardsSection"

interface RewardActionsSectionProps {
  isConnected: boolean
  wrongNetwork: boolean
  rewards: ReturnType<typeof useRewards>
  /** SAFE in the connected wallet. Undefined while unknown. */
  walletBalance: bigint | undefined
  onClaim: () => void
  onClaimAndStake: () => void
  onStakeBalance: () => void
}

type BlockerInput = Pick<RewardActionsSectionProps, "isConnected" | "wrongNetwork" | "rewards">

/** Why Claim is unavailable, in the order a user would fix it. Undefined when it is available. */
function claimBlocker({ isConnected, wrongNetwork, rewards }: BlockerInput) {
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
  const { rewards, walletBalance, onClaim, onClaimAndStake, onStakeBalance } = props
  const blocker = claimBlocker(props)
  const claimDisabled = blocker !== undefined || rewards.isLoading || !rewards.data.canClaim

  // An address that earned rewards, has claimed them all and holds SAFE: a claim followed by
  // a closed dialog lands here, so the primary action stakes the balance instead of dead-ending.
  const offerStakeBalance =
    claimDisabled &&
    props.isConnected &&
    !props.wrongNetwork &&
    !rewards.isLoading &&
    !rewards.error &&
    !!rewards.proof &&
    !rewards.data.rootStale &&
    rewards.data.claimable === 0n &&
    walletBalance !== undefined &&
    walletBalance > 0n

  return (
    <RewardsSection
      title="Actions"
      source="Claiming sends a transaction to the MerkleDrop contract on Ethereum. Staking sends one to the staking contract."
    >
      <div className="flex flex-wrap gap-3">
        {offerStakeBalance ? (
          <Button variant="gradient" onClick={onStakeBalance}>
            Stake your balance
          </Button>
        ) : (
          <Button variant="gradient" disabled={claimDisabled} onClick={onClaimAndStake}>
            Claim &amp; Stake
          </Button>
        )}
        <Button variant="outline" disabled={claimDisabled} onClick={onClaim}>
          Claim
        </Button>
      </div>
      {blocker && <SectionNote>{blocker}</SectionNote>}
      {!blocker && !claimDisabled && (
        <SectionNote>
          Rewards do not compound. Claim &amp; Stake claims them, then stakes what arrives.
        </SectionNote>
      )}
      {offerStakeBalance && <SectionNote>The SAFE in your wallet earns nothing until you stake it.</SectionNote>}
    </RewardsSection>
  )
}
