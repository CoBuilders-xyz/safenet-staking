import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatRow } from "@/components/rewards/RewardsSection"
import { useNetworkQuery, useNetworkTotals } from "@/hooks/useNetworkTotals"
import { useValidatorStakes, type ValidatorStakeRow } from "@/hooks/useValidatorStakes"
import { useRewardsOverview } from "@/hooks/useRewardsOverview"
import { RECENT_DAYS, useRecentDays } from "@/hooks/useRecentDays"
import { useConsensusFigures } from "@/hooks/useConsensusFigures"
import { findValidator, useValidators } from "@/hooks/useValidators"
import { hhi } from "@/lib/distribution"
import type { FigureSource } from "@/lib/figure"
import { formatTokenAmount, formatUtcDateTime } from "@/lib/format"
import { BETA_ENDED_NOTICE, PARTICIPATION_RULE } from "@/lib/programme"
import { ChainFreshness } from "./Freshness"
import { Distribution } from "./Distribution"
import { FigureValue, OverviewSection } from "./OverviewSection"
import { Stat } from "./Stat"
import { Validators, type ValidatorTableRow } from "./Validators"

const safe = (v: bigint) => `${formatTokenAmount(v, 18, 0)} SAFE`
const dayOf = (unixSeconds: number) => formatUtcDateTime(new Date(unixSeconds * 1000).toISOString()).replace(/, \d\d:\d\d UTC$/, "")

/** The sentence naming a Mainnet figure's source. */
function mainnetSource(source: FigureSource): string {
  switch (source) {
    case "subgraph":
      return "Mainnet subgraph"
    case "contract":
      return "Read directly from the contracts on Ethereum"
    case "sef":
      return "SEF's published validator list"
    case "snapshot":
      return "Snapshot"
  }
}

export function FreshnessPanel() {
  const mainnet = useNetworkQuery()
  const { subgraph: gnosis, snapshot } = useConsensusFigures()
  return (
    <section aria-label="Data freshness" role="status" className="space-y-2 rounded-lg border border-border bg-card px-5 py-4">
      <ChainFreshness
        chain="Mainnet"
        result={mainnet}
        fallback="Staking and rewards figures are read directly from the contracts on Ethereum instead."
      />
      <ChainFreshness
        chain="Gnosis"
        result={gnosis}
        fallback={`Attestation figures come from a snapshot measured ${formatUtcDateTime(snapshot.runAt)}, and participation from SEF's published figure where SEF publishes one.`}
      />
    </section>
  )
}

/**
 * Above Gnosis figures that all describe Beta. Shown from the data, not the calendar alone: it
 * goes once the index holds an Aegis day with a ceremony.
 */
export function BetaEndedNotice() {
  return (
    <p role="note" aria-label="Beta ended" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      {BETA_ENDED_NOTICE}
    </p>
  )
}

/** The label of Gnosis figures that describe Beta: the days the window actually covers. */
const betaWindow = (window: { from: number; to: number }) => `Beta, ${dayOf(window.from)} to ${dayOf(window.to)}`

export function HeadlineStats() {
  const { totalStaked, validatorCounts } = useNetworkTotals()
  const { attestations, latency, window, snapshot, snapshotReason, betaOnly } = useConsensusFigures()
  // A snapshot figure says why it is shown. The freshness panel says so too when the subgraph is
  // down, but not when it is live and simply has no complete day yet.
  const gnosisSource = (source: FigureSource) =>
    source === "subgraph" && window
      ? betaOnly
        ? `${betaWindow(window)}. Gnosis subgraph, complete UTC days.`
        : `Gnosis subgraph, complete UTC days ${dayOf(window.from)} to ${dayOf(window.to)}`
      : `Snapshot measured ${formatUtcDateTime(snapshot.runAt)}.${snapshotReason ? ` ${snapshotReason}` : ""}`

  return (
    <div className="space-y-4">
      {betaOnly && <BetaEndedNotice />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total SAFE staked" figure={totalStaked} format={(v) => formatTokenAmount(v, 18, 0)} source={mainnetSource} />
        <Stat
          label="Active validators"
          figure={validatorCounts}
          format={(v) => (
            <>
              {v.active} active
              {v.withdrawn > 0 && (
                <span className="ml-3 inline-block whitespace-nowrap align-middle font-sans text-sm tracking-normal text-warning">
                  {v.withdrawn} withdrawn
                </span>
              )}
            </>
          )}
          detail={(v) => (v.withdrawn > 0 ? "Withdrawn: Aegis participation unconfirmed." : undefined)}
          source={mainnetSource}
        />
        <Stat
          label="Attestations per day"
          figure={attestations}
          format={(v) => v.mean.toLocaleString("en-US")}
          detail={(v) => `Mean over ${v.days} complete days, range ${v.min.toLocaleString("en-US")} to ${v.max.toLocaleString("en-US")}`}
          source={gnosisSource}
        />
        <Stat
          label="Attestation latency"
          figure={latency}
          format={(v) => `~${v.seconds} s`}
          detail={(v) => `Median of ${v.medianBlocks} blocks from proposal to attestation`}
          source={gnosisSource}
          tone="accent"
        />
      </div>
    </div>
  )
}

export function DistributionPanel() {
  const { rows } = useValidatorStakes()
  return (
    <OverviewSection
      title="Stake distribution"
      source={rows.state === "ready" ? `${mainnetSource(rows.source)}.` : undefined}
    >
      <FigureValue
        figure={rows}
        skeletonClassName="block h-24 w-full"
        format={(r) => (r.length === 0 ? "No validator holds stake yet." : <Distribution rows={r} index={hhi(r)} />)}
      />
    </OverviewSection>
  )
}

export function RewardsPanel() {
  const { allocated, claimed, unclaimed, rootMatches } = useRewardsOverview()
  // Tenths of a percent, rounded once, so the two labels always add up to 100.0.
  const claimedTenths =
    allocated.state === "ready" && claimed.state === "ready" && allocated.value > 0n && claimed.value <= allocated.value
      ? Number((claimed.value * 2_000n + allocated.value) / (2n * allocated.value))
      : undefined
  const claimedSource =
    claimed.state !== "ready"
      ? ""
      : claimed.source === "subgraph"
        ? " Claimed: the Mainnet subgraph's sum of Claimed events; unclaimed is allocated minus that."
        : " Claimed and unclaimed: allocated minus the MerkleDrop's live SAFE balance."

  return (
    <OverviewSection title="Rewards" source={`Allocated: SEF's published rewards file.${claimedSource}`}>
      <dl>
        <StatRow label="Allocated to date">
          <FigureValue figure={allocated} format={safe} />
        </StatRow>
        <StatRow label="Claimed">
          <FigureValue figure={claimed} format={safe} />
        </StatRow>
        <StatRow label="Unclaimed">
          <FigureValue figure={unclaimed} format={safe} />
        </StatRow>
      </dl>
      {claimedTenths !== undefined && (
        <div className="space-y-1.5">
          <Progress value={claimedTenths / 10} aria-label="Share of allocated rewards claimed" />
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>{(claimedTenths / 10).toFixed(1)}% claimed</span>
            <span>{((1000 - claimedTenths) / 10).toFixed(1)}% unclaimed</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Merkle root on chain against SEF&apos;s published root</span>
        {rootMatches === undefined ? (
          <span className="text-muted-foreground">Not compared yet</span>
        ) : rootMatches ? (
          <Badge variant="outline" className="border-success text-success">Match</Badge>
        ) : (
          <Badge variant="destructive">Differs</Badge>
        )}
      </div>
    </OverviewSection>
  )
}

export function ValidatorsPanel() {
  const { rows } = useValidatorStakes()
  const { participation, window, betaOnly } = useConsensusFigures()
  const sef = useValidators()

  const tableRows = (stakes: ValidatorStakeRow[]): ValidatorTableRow[] =>
    stakes.map((r) => {
      const ours = participation?.get(r.address.toLowerCase())
      const published = findValidator(sef.data, r.address)
      return {
        ...r,
        participation: ours
          ? ours.rate
          : published?.participationRate != null ? published.participationRate / 100 : undefined,
        participationSource: ours ? "subgraph" : published ? "sef" : undefined,
        absences: ours?.absences,
        status: !sef.data ? undefined : !published ? "unlisted" : published.isActive ? "active" : "withdrawn",
      }
    })

  // The caption names the sources the rows actually use. A validator with no ValidatorDay row in
  // the window falls back to SEF's figure even while the subgraph is live; such rows are marked.
  const fromSubgraph = participation && window && rows.state === "ready" && rows.value.some((r) => participation.has(r.address.toLowerCase()))
  // The rows that fall back to SEF's file are the ones it lists. A validator SEF does not list has
  // no SEF figure and says nothing about SEF's rates. SEF's file can also list every validator with
  // a null rate; then no row carries SEF's figure.
  const sefRows = rows.state === "ready" ? rows.value.filter((r) => !participation?.has(r.address.toLowerCase())) : []
  const sefListed = sefRows.map((r) => findValidator(sef.data, r.address)).filter((v) => v !== null)
  const fromSef = sefListed.length > 0
  const sefPublishesNone = fromSef && sefListed.every((v) => v.participationRate === null)
  const subgraphWords = !window
    ? ""
    : betaOnly
      ? `${betaWindow(window)}: the Gnosis subgraph, attestation ceremonies attended over ${window.days} complete UTC days`
      : `the Gnosis subgraph, attestation ceremonies attended over ${window.days} complete UTC days to ${dayOf(window.to)}`
  const sefWords = sefPublishesNone ? "SEF publishes no 14-day figure at present" : "SEF's published 14-day figure"
  const participationSource =
    fromSubgraph && fromSef
      ? sefPublishesNone
        ? `Participation: ${subgraphWords}; for the other rows, ${sefWords}.`
        : `Participation: ${subgraphWords}; rows marked "SEF file" use ${sefWords}.`
      : fromSubgraph
        ? `Participation: ${subgraphWords}.`
        : `Participation: ${sefWords}.`

  return (
    <OverviewSection
      title="Validators"
      source={rows.state === "ready" ? `Stake: ${mainnetSource(rows.source)}. ${participationSource} ${PARTICIPATION_RULE}` : undefined}
    >
      {betaOnly && fromSubgraph && <BetaEndedNotice />}
      <FigureValue
        figure={rows}
        skeletonClassName="block h-48 w-full"
        format={(r) => (r.length === 0 ? "No validator is registered yet." : <Validators rows={tableRows(r)} />)}
      />
    </OverviewSection>
  )
}

export function ActivityPanel() {
  const { activity } = useRecentDays()
  const { stakers } = useNetworkTotals()
  return (
    <OverviewSection
      title={`Last ${RECENT_DAYS} days`}
      source={
        activity.state === "ready"
          ? `Mainnet subgraph, daily buckets since ${dayOf(activity.value.since)}.`
          : undefined
      }
    >
      {activity.state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">Unavailable. {activity.reason}</p>
      ) : (
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <StatRow label="Stakers now">
            <FigureValue figure={stakers} format={(v) => v.toLocaleString("en-US")} />
          </StatRow>
          <StatRow label="Staked in">
            <FigureValue figure={activity} format={(a) => safe(a.stakedIn)} />
          </StatRow>
          <StatRow label="Withdrawn">
            <FigureValue figure={activity} format={(a) => safe(a.withdrawnOut)} />
          </StatRow>
          <StatRow label="Rewards claimed">
            <FigureValue figure={activity} format={(a) => safe(a.rewardsClaimed)} />
          </StatRow>
          <StatRow label="Stakes">
            <FigureValue figure={activity} format={(a) => a.stakes.toLocaleString("en-US")} />
          </StatRow>
          <StatRow label="Withdrawals">
            <FigureValue figure={activity} format={(a) => a.withdrawals.toLocaleString("en-US")} />
          </StatRow>
        </dl>
      )}
    </OverviewSection>
  )
}
