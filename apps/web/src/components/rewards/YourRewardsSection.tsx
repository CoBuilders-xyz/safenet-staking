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
  const { data, proof, proofSource, isLoading, error, refetch, hasMerkleDrop } = rewards
  const caveat = proofAbsenceCaveat(proofSource)

  return (
    <RewardsSection
      title="Your rewards"
      source="Earned: SEF's published reward file for your address. Claimed: the MerkleDrop contract on Ethereum."
    >
      {!isConnected ? (
        <div className="space-y-4">
          <SectionNote>
            Safenet pays rewards to the addresses that stake SAFE. Connect a wallet to see what it
            earned and claim it.
          </SectionNote>
          <ConnectButton />
        </div>
      ) : !hasMerkleDrop ? (
        <SectionNote>{MESSAGES.noMerkleDrop}</SectionNote>
      ) : error ? (
        <SectionError message="Your rewards could not be loaded." onRetry={refetch} />
      ) : isLoading ? (
        <SectionLoading />
      ) : proof === null ? (
        <>
          <SectionNote>
            This address has not earned Safenet rewards. SEF publishes no reward file for it.
          </SectionNote>
          {caveat && <p className="text-xs text-muted-foreground">{caveat}</p>}
        </>
      ) : proof ? (
        <>
          <dl>
            <StatRow label="Available to claim">{formatTokenAmount(data.claimable)} SAFE</StatRow>
            <StatRow label="Cumulative earned">{formatTokenAmount(BigInt(proof.cumulativeAmount))} SAFE</StatRow>
            <StatRow label="Already claimed">{formatTokenAmount(data.totalClaimed)} SAFE</StatRow>
          </dl>
          <HeldPendingCompliance amount={heldPendingCompliance(proof)} />
        </>
      ) : null}
    </RewardsSection>
  )
}

function HeldPendingCompliance({ amount }: { amount: bigint }) {
  if (amount === 0n) return null
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
      <dl>
        <StatRow label="Held pending compliance">{formatTokenAmount(amount)} SAFE</StatRow>
      </dl>
      <SectionNote>
        SEF holds this part of your reward until its compliance checks for this address are complete.
      </SectionNote>
    </div>
  )
}
