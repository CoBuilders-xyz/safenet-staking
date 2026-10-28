import { useTranslation } from "react-i18next"
import { ConnectButton } from "@/components/wallet/ConnectButton"
import type { useRewards } from "@/hooks/useRewards"
import { heldPendingCompliance } from "@/hooks/useRewardProof"
import { formatTokenAmount } from "@/lib/format"
import { proofAbsenceCaveat } from "@/lib/rewardsSource"
import { MESSAGES } from "./messages"
import { RewardsSection, SectionError, SectionLoading, SectionNote, StatRow } from "./RewardsSection"

interface YourRewardsSectionProps {
  isConnected: boolean
  rewards: ReturnType<typeof useRewards>
}

export function YourRewardsSection({ isConnected, rewards }: YourRewardsSectionProps) {
  const { t } = useTranslation()
  const { data, proof, proofSource, isLoading, error, refetch, hasMerkleDrop } = rewards
  const caveat = proofAbsenceCaveat(proofSource)

  return (
    <RewardsSection
      title={t("rewards.yourRewards", "Your rewards")}
      source={t("rewards.earnedSefSPublishedRewardFileForYour", "Earned: SEF's published reward file for your address. Claimed: the MerkleDrop contract on Ethereum.")}
    >
      {!isConnected ? (
        <div className="space-y-4">
          <SectionNote>{t("rewards.safenetPaysRewardsToTheAddressesThatStake", "Safenet pays rewards to the addresses that stake SAFE. Connect a wallet to see what it earned and claim it.")}</SectionNote>
          <ConnectButton />
        </div>
      ) : !hasMerkleDrop ? (
        <SectionNote>{MESSAGES.noMerkleDrop}</SectionNote>
      ) : error ? (
        <SectionError message={t("rewards.yourRewardsCouldNotBeLoaded", "Your rewards could not be loaded.")} onRetry={refetch} />
      ) : isLoading ? (
        <SectionLoading />
      ) : proof === null ? (
        <>
          <SectionNote>{t("rewards.thisAddressHasNotEarnedSafenetRewardsSef", "This address has not earned Safenet rewards. SEF publishes no reward file for it.")}</SectionNote>
          {caveat && <p className="text-xs text-muted-foreground">{caveat}</p>}
        </>
      ) : proof ? (
        <>
          <dl>
            <StatRow label={t("rewards.availableToClaim", "Available to claim")}>{formatTokenAmount(data.claimable)} SAFE</StatRow>
            <StatRow label={t("rewards.cumulativeEarned", "Cumulative earned")}>{formatTokenAmount(BigInt(proof.cumulativeAmount))} SAFE</StatRow>
            <StatRow label={t("rewards.alreadyClaimed", "Already claimed")}>{formatTokenAmount(data.totalClaimed)} SAFE</StatRow>
          </dl>
          <HeldPendingCompliance amount={heldPendingCompliance(proof)} />
        </>
      ) : null}
    </RewardsSection>
  )
}

function HeldPendingCompliance({ amount }: { amount: bigint }) {
  const { t } = useTranslation()
  if (amount === 0n) return null
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
      <dl>
        <StatRow label={t("rewards.heldPendingCompliance", "Held pending compliance")}>{formatTokenAmount(amount)} SAFE</StatRow>
      </dl>
      <SectionNote>{t("rewards.sefHoldsThisPartOfYourRewardUntil", "SEF holds this part of your reward until its compliance checks for this address are complete.")}</SectionNote>
    </div>
  )
}
