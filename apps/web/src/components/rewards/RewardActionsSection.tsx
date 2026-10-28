import { useTranslation } from "react-i18next"
import { i18n } from "@/i18n"
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
  if (!isConnected) return i18n.t("rewards.connectAWalletToClaim", "Connect a wallet to claim.")
  if (wrongNetwork) return i18n.t("rewards.yourWalletIsOnAnotherNetworkSwitchTo2", "Your wallet is on another network. Switch to Ethereum to claim.")
  if (rewards.error) return i18n.t("rewards.claimingNeedsYourRewardDataWhichDidNot", "Claiming needs your reward data, which did not load.")
  if (rewards.isLoading) return undefined
  if (rewards.proof === null) return i18n.t("rewards.thisAddressHasNothingToClaim", "This address has nothing to claim.")
  if (rewards.data.rootStale) {
    return i18n.t("rewards.yourRewardFileWasBuiltForADifferent", "Your reward file was built for a different Merkle root than the one on chain. Claiming opens when they match.")
  }
  if (!rewards.data.canClaim) return i18n.t("rewards.nothingToClaimRightNow", "Nothing to claim right now.")
  return undefined
}

export function RewardActionsSection(props: RewardActionsSectionProps) {
  const { t } = useTranslation()
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
      title={t("rewards.actions", "Actions")}
      source={t("rewards.claimingSendsATransactionToTheMerkledropContract", "Claiming sends a transaction to the MerkleDrop contract on Ethereum. Staking sends one to the staking contract.")}
    >
      <div className="flex flex-wrap gap-3">
        {offerStakeBalance ? (
          <Button variant="gradient" onClick={onStakeBalance}>{t("rewards.stakeYourBalance", "Stake your balance")}</Button>
        ) : (
          <Button variant="gradient" disabled={claimDisabled} onClick={onClaimAndStake}>{t("rewards.claimStake", "Claim & Stake")}</Button>
        )}
        <Button variant="outline" disabled={claimDisabled} onClick={onClaim}>{t("rewards.claim2", "Claim")}</Button>
      </div>
      {blocker && <SectionNote>{blocker}</SectionNote>}
      {!blocker && !claimDisabled && (
        <SectionNote>{t("rewards.rewardsDoNotCompoundClaimStakeClaimsThem", "Rewards do not compound. Claim & Stake claims them, then stakes what arrives.")}</SectionNote>
      )}
      {offerStakeBalance && <SectionNote>{t("rewards.theSafeInYourWalletEarnsNothingUntil", "The SAFE in your wallet earns nothing until you stake it.")}</SectionNote>}
    </RewardsSection>
  )
}
