import { Trans, useTranslation } from "react-i18next"
import { useEffect, useState, type ReactNode } from "react"
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
  if (!href) return <>{"rewards/latest.json"}</>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
      {"rewards/latest.json"}</a>
  )
}

export function ProgrammeSection({ programme }: { programme: ReturnType<typeof useProgrammeRewards> }) {
  const { t } = useTranslation()
  const { latest, onChainRoot, dropBalance, totals, rootMatches } = programme
  const contractError = onChainRoot.error ?? dropBalance.error

  return (
    <RewardsSection
      title={t("rewards.programme", "Programme")}
      source={<Trans i18nKey="rewards.programmeSource" defaults="Allocated, period and epoch: SEF's published file <file>rewards/latest.json</file>. Claimed and unclaimed: allocated minus the MerkleDrop's live SAFE balance on Ethereum, derived only while the contract holds the published root." components={{ file: <PublishedFileLink href={programme.latestSource?.url} /> }} />}
    >
      {latest.error ? (
        <SectionError message={MESSAGES.latestFileFailed} onRetry={() => void latest.refetch()} />
      ) : !latest.data ? (
        <SectionLoading rows={5} />
      ) : (
        <>
          <dl>
            <StatRow label={t("rewards.allocatedToDate", "Allocated to date")}>{formatTokenAmount(BigInt(latest.data.tokenTotal), 18, 0)} SAFE</StatRow>
            <StatRow label={t("rewards.claimedNetworkWide", "Claimed network-wide")}>
              <OnChainValue programme={programme}>
                {totals?.claimed !== undefined ? `${formatTokenAmount(totals.claimed, 18, 0)} SAFE` : t("rewards.notDerivable", "Not derivable")}
              </OnChainValue>
            </StatRow>
            <StatRow label={t("rewards.unclaimedShare", "Unclaimed share")}>
              <OnChainValue programme={programme}>
                {totals?.unclaimedPercent !== undefined ? `${totals.unclaimedPercent.toFixed(2)}%` : t("rewards.notDerivable", "Not derivable")}
              </OnChainValue>
            </StatRow>
            <StatRow label={t("rewards.lastComputedPeriodEnded", "Last computed period ended")} hint={<PeriodHint rewardsUntil={latest.data.rewardsUntil} />}>
              {formatUtcDateTime(latest.data.rewardsUntil)}
            </StatRow>
            <StatRow label={t("rewards.epoch", "Epoch")}>{latest.data.epoch}</StatRow>
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
            <SectionNote>{t("rewards.theRootOnChainDiffersFromTheOne", "The root on chain differs from the one SEF published, so allocated minus the contract balance does not measure claims.")}</SectionNote>
          )}
          {totals && totals.claimed === undefined && (
            <SectionNote>{t("rewards.theContractHoldsMoreSafeThanThePublished", "The contract holds more SAFE than the published allocation, so the difference does not measure claims.")}</SectionNote>
          )}
        </>
      )}
    </RewardsSection>
  )
}

/** A value derived from both on-chain reads: the root (to gate it) and the balance. */
function OnChainValue({ programme, children }: { programme: ReturnType<typeof useProgrammeRewards>; children: ReactNode }) {
  const { t } = useTranslation()
  const { onChainRoot, dropBalance } = programme
  if (onChainRoot.error || dropBalance.error) return <>{t("rewards.unavailable", "Unavailable")}</>
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
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const overdue = now > Date.parse(rewardsUntil) + REWARD_PERIOD_MS
  return overdue ? t("rewards.noPeriodEndingAfterThisDateHasBeen", "No period ending after this date has been published.") : t("rewards.periodsRunTwoWeeksTuesdayToTuesdayUtc", "Periods run two weeks, Tuesday to Tuesday UTC.")
}
