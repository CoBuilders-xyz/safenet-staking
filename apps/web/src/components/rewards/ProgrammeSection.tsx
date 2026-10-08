import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { REWARD_PERIOD_MS, type useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { formatTokenAmount, formatUtcDateTime } from "@/lib/format"
import { MESSAGES } from "./messages"
import { RewardsSection, SectionError, SectionLoading, SectionNote, StatRow } from "./RewardsSection"

/**
 * The source caption shared by the two programme-wide sections. It links the file that was
 * read, from whichever source answered, once one has.
 */
export function PublishedFileLink({ href }: { href: string | undefined }) {
  if (!href) return <>rewards/latest.json</>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
      rewards/latest.json
    </a>
  )
}

export function ProgrammeSection({ programme }: { programme: ReturnType<typeof useProgrammeRewards> }) {
  const { latest, onChainRoot, dropBalance, totals, rootMatches } = programme
  const contractError = onChainRoot.error ?? dropBalance.error

  return (
    <RewardsSection
      title="Programme"
      source={
        <>
          Allocated, period and epoch: SEF&apos;s published file{" "}
          <PublishedFileLink href={programme.latestSource?.url} />. Claimed and
          unclaimed: allocated minus the MerkleDrop&apos;s live SAFE balance on Ethereum, derived only
          while the contract holds the published root.
        </>
      }
    >
      {latest.error ? (
        <SectionError message={MESSAGES.latestFileFailed} onRetry={() => void latest.refetch()} />
      ) : !latest.data ? (
        <SectionLoading rows={5} />
      ) : (
        <>
          <dl>
            <StatRow label="Allocated to date">{formatTokenAmount(BigInt(latest.data.tokenTotal), 18, 0)} SAFE</StatRow>
            <StatRow label="Claimed network-wide">
              <OnChainValue programme={programme}>
                {totals?.claimed !== undefined ? `${formatTokenAmount(totals.claimed, 18, 0)} SAFE` : "Not derivable"}
              </OnChainValue>
            </StatRow>
            <StatRow label="Unclaimed share">
              <OnChainValue programme={programme}>
                {totals?.unclaimedPercent !== undefined ? `${totals.unclaimedPercent.toFixed(2)}%` : "Not derivable"}
              </OnChainValue>
            </StatRow>
            <StatRow label="Last computed period ended" hint={<PeriodHint rewardsUntil={latest.data.rewardsUntil} />}>
              {formatUtcDateTime(latest.data.rewardsUntil)}
            </StatRow>
            <StatRow label="Epoch">{latest.data.epoch}</StatRow>
          </dl>
          {contractError && (
            <SectionError
              message={MESSAGES.contractReadFailed}
              onRetry={() => {
                void onChainRoot.refetch()
                void dropBalance.refetch()
              }}
            />
          )}
          {rootMatches === false && (
            <SectionNote>
              The root on chain differs from the one SEF published, so allocated minus the contract
              balance does not measure claims.
            </SectionNote>
          )}
          {totals && totals.claimed === undefined && (
            <SectionNote>
              The contract holds more SAFE than the published allocation, so the difference does not
              measure claims.
            </SectionNote>
          )}
          <p className="text-xs text-muted-foreground">File updated {formatUtcDateTime(latest.data.updatedAt)}.</p>
        </>
      )}
    </RewardsSection>
  )
}

/** A value derived from both on-chain reads: the root (to gate it) and the balance. */
function OnChainValue({ programme, children }: { programme: ReturnType<typeof useProgrammeRewards>; children: ReactNode }) {
  const { onChainRoot, dropBalance } = programme
  if (onChainRoot.error || dropBalance.error) return <>Unavailable</>
  if (onChainRoot.data === undefined || dropBalance.data === undefined) {
    return <Skeleton className="inline-block h-5 w-24 align-middle" />
  }
  return <>{children}</>
}

/**
 * SEF publishes a period after it ends. Once a full period has passed beyond `rewardsUntil`
 * with no newer file, say so; never predict when, or whether, the next one comes.
 */
function PeriodHint({ rewardsUntil }: { rewardsUntil: string }) {
  const overdue = Date.now() > Date.parse(rewardsUntil) + REWARD_PERIOD_MS
  return overdue ? "No period ending after this date has been published." : "Periods run two weeks, Tuesday to Tuesday UTC."
}
