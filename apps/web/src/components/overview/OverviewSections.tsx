import type { TFunction } from "i18next"
import { Trans, useTranslation } from "react-i18next"
import { AEGIS_START_DAY, BETA_END_DAY, REWARD_PARTICIPATION_THRESHOLD, utcDayMs } from "@cobuilders/safenet-core"
import { Badge } from "@/components/ui/badge"
import { Term } from "@/components/ui/term"
import { Progress } from "@/components/ui/progress"
import { StatRow } from "@/components/rewards/RewardsSection"
import { useNetworkQuery, useNetworkTotals } from "@/hooks/useNetworkTotals"
import { useValidatorStakes, type ValidatorStakeRow } from "@/hooks/useValidatorStakes"
import { useRewardsOverview } from "@/hooks/useRewardsOverview"
import { RECENT_DAYS, useRecentDays } from "@/hooks/useRecentDays"
import { useConsensusFigures } from "@/hooks/useConsensusFigures"
import { useEstimatedApr } from "@/hooks/useEstimatedApr"
import { findValidator, useValidators } from "@/hooks/useValidators"
import { hhi } from "@/lib/distribution"
import type { FigureSource } from "@/lib/figure"
import { formatTokenAmount, formatUtcDateTime, formatUtcDayLong, formatUtcDayRange } from "@/lib/format"
import { ChainFreshness } from "./Freshness"
import { Distribution } from "./Distribution"
import { FigureValue, OverviewSection } from "./OverviewSection"
import { Stat } from "./Stat"
import { Validators, type ValidatorTableRow } from "./Validators"

const safe = (v: bigint) => `${formatTokenAmount(v, 18, 0)} SAFE`
const dayOf = (unixSeconds: number) => formatUtcDateTime(new Date(unixSeconds * 1000).toISOString()).replace(/, \d\d:\d\d UTC$/, "")

/** The sentence naming a Mainnet figure's source. */
function mainnetSource(source: FigureSource, t: TFunction): string {
  switch (source) {
    case "subgraph":
      return t("overview.source.mainnetSubgraph", "Mainnet subgraph")
    case "contract":
      return t("overview.source.contract", "Read directly from the contracts on Ethereum")
    case "sef":
      return t("overview.source.sef", "SEF's published validator list")
    case "snapshot":
      return t("overview.source.snapshot", "Snapshot")
  }
}

/**
 * SEF's reward rule. `PARTICIPATION_RULE` in lib/programme.ts retains the reference English;
 * src/i18n/__tests__ holds the two to the same text, as it does the
 * other `programme.*` keys and their constants.
 */
const participationRule = (t: TFunction) =>
  t(
    "programme.participationRule",
    "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.",
    { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 },
  )

export function FreshnessPanel() {
  const { t } = useTranslation()
  const mainnet = useNetworkQuery()
  const { subgraph: gnosis, snapshot } = useConsensusFigures()
  return (
    <section
      aria-label={t("overview.freshness.title", "Data freshness")}
      role="status"
      className="space-y-2 rounded-lg border border-border bg-card px-5 py-4"
    >
      <ChainFreshness
        chain="Mainnet"
        result={mainnet}
        fallback={t(
          "overview.freshness.mainnetFallback",
          "Staking and rewards figures are read directly from the contracts on Ethereum instead.",
        )}
      />
      <ChainFreshness
        chain="Gnosis"
        result={gnosis}
        fallback={t(
          "overview.freshness.gnosisFallback",
          "Attestation figures come from a snapshot measured {{runAt}}, and participation from SEF's published figure where SEF publishes one.",
          { runAt: formatUtcDateTime(snapshot.runAt) },
        )}
      />
    </section>
  )
}

/**
 * Above Gnosis figures that all describe Beta. Shown from the data, not the calendar alone: it
 * goes once the index holds an Aegis day with a ceremony. The text is `BETA_ENDED_NOTICE` in
 * lib/programme.ts, with both dates from core and the same date formatter in every language.
 */
export function BetaEndedNotice() {
  const { t } = useTranslation()
  return (
    <p
      role="note"
      aria-label={t("programme.betaEndedLabel", "Beta ended")}
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
    >
      {t("programme.betaEnded", "Beta ended on {{betaEnd}}. Aegis data starts on {{aegisStart}}.", {
        betaEnd: formatUtcDayLong(utcDayMs(BETA_END_DAY)),
        aegisStart: formatUtcDayLong(utcDayMs(AEGIS_START_DAY)),
      })}
    </p>
  )
}

/** The label of Gnosis figures that describe Beta: the days the window actually covers. */
const betaWindow = (window: { from: number; to: number }, t: TFunction) =>
  t("overview.betaWindow", "Beta, {{from}} to {{to}}", { from: dayOf(window.from), to: dayOf(window.to) })

export function HeadlineStats() {
  const { t } = useTranslation()
  const { totalStaked, validatorCounts } = useNetworkTotals()
  const { attestations, latency, window, snapshot, snapshotReason, betaOnly } = useConsensusFigures()
  const apr = useEstimatedApr()
  const fromMainnet = (source: FigureSource) => mainnetSource(source, t)
  // A snapshot figure says why it is shown. The freshness panel says so too when the subgraph is
  // down, but not when it is live and simply has no complete day yet.
  const gnosisSource = (source: FigureSource) =>
    source === "subgraph" && window
      ? betaOnly
        ? t("overview.headline.gnosisSourceBeta", "{{beta}}. Gnosis subgraph, complete UTC days.", { beta: betaWindow(window, t) })
        : t("overview.headline.gnosisSource", "Gnosis subgraph, complete UTC days {{from}} to {{to}}", {
            from: dayOf(window.from),
            to: dayOf(window.to),
          })
      : snapshotReason
        ? t("overview.headline.snapshotSourceWithReason", "Snapshot measured {{runAt}}. {{reason}}", {
            runAt: formatUtcDateTime(snapshot.runAt),
            reason: snapshotReason,
          })
        : t("overview.headline.snapshotSource", "Snapshot measured {{runAt}}.", { runAt: formatUtcDateTime(snapshot.runAt) })

  return (
    <div className="space-y-4">
      {betaOnly && <BetaEndedNotice />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label={t("overview.headline.totalStaked", "Total SAFE staked")}
          figure={totalStaked}
          format={(v) => formatTokenAmount(v, 18, 0)}
          source={fromMainnet}
        />
        <Stat
          label={t("overview.headline.estimatedApr", "Estimated APR")}
          figure={apr}
          format={(v) => `${(v.apr * 100).toFixed(1)}%`}
          detail={(v) => (
            <Trans
              i18nKey="overview.headline.estimatedAprDetail"
              defaults="Last reward period ({{period}}), before validator commission. <term>How it is estimated</term>"
              values={{ period: formatUtcDayRange(v.periodStart * 1000, (v.periodEnd - 86_400) * 1000) }}
              components={{ term: <Term term="estimatedApr" children={null} /> }}
            />
          )}
          source={() => t("overview.headline.estimatedAprSource", "Source: SEF rewards file, Mainnet subgraph.")}
        />
        <Stat
          label={t("overview.headline.activeValidators", "Active validators")}
          figure={validatorCounts}
          format={(v) => (
            <>
              {t("overview.headline.activeCount", "{{count}} active", { count: v.active })}
              {v.withdrawn > 0 && (
                <span className="ml-3 inline-block whitespace-nowrap align-middle font-sans text-sm tracking-normal text-warning">
                  {t("overview.headline.withdrawnCount", "{{count}} withdrawn", { count: v.withdrawn })}
                </span>
              )}
            </>
          )}
          detail={(v) =>
            v.withdrawn > 0 ? t("overview.headline.withdrawnDetail", "Withdrawn: Aegis participation unconfirmed.") : undefined
          }
          source={fromMainnet}
        />
        <Stat
          label={t("overview.headline.attestationsPerDay", "Attestations per day")}
          figure={attestations}
          format={(v) => v.mean.toLocaleString("en-US")}
          detail={(v) =>
            t("overview.headline.attestationsDetail", "Mean over {{count}} complete days, range {{min}} to {{max}}", {
              count: v.days,
              min: v.min.toLocaleString("en-US"),
              max: v.max.toLocaleString("en-US"),
            })
          }
          source={gnosisSource}
        />
        <Stat
          label={t("overview.headline.latency", "Attestation latency")}
          figure={latency}
          format={(v) => t("overview.headline.latencyValue", "~{{n}} s", { n: v.seconds })}
          detail={(v) =>
            t("overview.headline.latencyDetail", "Median of {{count}} blocks from proposal to attestation", {
              count: v.medianBlocks,
            })
          }
          source={gnosisSource}
          tone="accent"
        />
      </div>
    </div>
  )
}

export function DistributionPanel() {
  const { t } = useTranslation()
  const { rows } = useValidatorStakes()
  return (
    <OverviewSection
      title={t("overview.distribution.title", "Stake distribution")}
      source={
        rows.state === "ready" ? t("overview.sourceSentence", "{{source}}.", { source: mainnetSource(rows.source, t) }) : undefined
      }
    >
      <FigureValue
        figure={rows}
        skeletonClassName="block h-24 w-full"
        format={(r) =>
          r.length === 0 ? t("overview.distribution.empty", "No validator holds stake yet.") : <Distribution rows={r} index={hhi(r)} />
        }
      />
    </OverviewSection>
  )
}

export function RewardsPanel() {
  const { t } = useTranslation()
  const { allocated, claimed, unclaimed, rootMatches } = useRewardsOverview()
  // Tenths of a percent, rounded once, so the two labels always add up to 100.0.
  const claimedTenths =
    allocated.state === "ready" && claimed.state === "ready" && allocated.value > 0n && claimed.value <= allocated.value
      ? Number((claimed.value * 2_000n + allocated.value) / (2n * allocated.value))
      : undefined
  const allocatedSource = t("overview.rewards.sourceAllocated", "Allocated: SEF's published rewards file.")
  const claimedSource =
    claimed.state !== "ready"
      ? undefined
      : claimed.source === "subgraph"
        ? t(
            "overview.rewards.sourceClaimedSubgraph",
            "Claimed: the Mainnet subgraph's sum of Claimed events; unclaimed is allocated minus that.",
          )
        : t("overview.rewards.sourceClaimedContract", "Claimed and unclaimed: allocated minus the MerkleDrop's live SAFE balance.")

  return (
    <OverviewSection
      title={t("overview.rewards.title", "Rewards")}
      source={claimedSource ? `${allocatedSource} ${claimedSource}` : allocatedSource}
    >
      <dl>
        <StatRow label={t("overview.rewards.allocated", "Allocated to date")}>
          <FigureValue figure={allocated} format={safe} />
        </StatRow>
        <StatRow label={t("overview.rewards.claimed", "Claimed")}>
          <FigureValue figure={claimed} format={safe} />
        </StatRow>
        <StatRow label={t("overview.rewards.unclaimed", "Unclaimed")}>
          <FigureValue figure={unclaimed} format={safe} />
        </StatRow>
      </dl>
      {claimedTenths !== undefined && (
        <div className="space-y-1.5">
          <Progress
            value={claimedTenths / 10}
            aria-label={t("overview.rewards.progressLabel", "Share of allocated rewards claimed")}
          />
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>{t("overview.rewards.percentClaimed", "{{percent}}% claimed", { percent: (claimedTenths / 10).toFixed(1) })}</span>
            <span>
              {t("overview.rewards.percentUnclaimed", "{{percent}}% unclaimed", {
                percent: ((1000 - claimedTenths) / 10).toFixed(1),
              })}
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">
          {t("overview.rewards.rootCheck", "Merkle root on chain against SEF's published root")}
        </span>
        {rootMatches === undefined ? (
          <span className="text-muted-foreground">{t("overview.rewards.rootNotCompared", "Not compared yet")}</span>
        ) : rootMatches ? (
          <Badge variant="outline" className="border-success text-success">
            {t("overview.rewards.rootMatch", "Match")}
          </Badge>
        ) : (
          <Badge variant="destructive">{t("overview.rewards.rootDiffers", "Differs")}</Badge>
        )}
      </div>
    </OverviewSection>
  )
}

export function ValidatorsPanel() {
  const { t } = useTranslation()
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

  // The caption names the sources the rows actually use. A validator outside the programme
  // membership falls back to SEF's figure even while the subgraph is live; such rows are marked.
  const fromSubgraph = participation && window && rows.state === "ready" && rows.value.some((r) => participation.has(r.address.toLowerCase()))
  // The rows that fall back to SEF's file are the ones it lists. A validator SEF does not list has
  // no SEF figure and says nothing about SEF's rates. SEF's file can also list every validator with
  // a null rate; then no row carries SEF's figure.
  const sefRows = rows.state === "ready" ? rows.value.filter((r) => !participation?.has(r.address.toLowerCase())) : []
  const sefListed = sefRows.map((r) => findValidator(sef.data, r.address)).filter((v) => v !== null)
  const fromSef = sefListed.length > 0
  const sefPublishesNone = fromSef && sefListed.every((v) => v.participationRate === null)
  const sefPublishesSome = !sefPublishesNone && sefListed.some((v) => v.participationRate === null)
  const sefNone = t("overview.validators.sefNone", "SEF publishes no 14-day figure at present")
  const subgraphWords = !window
    ? ""
    : betaOnly
      ? t(
          "overview.validators.subgraphWordsBeta",
          "{{beta}}: the Gnosis subgraph, attestation ceremonies attended over {{count}} complete UTC days",
          { beta: betaWindow(window, t), count: window.days },
        )
      : t(
          "overview.validators.subgraphWords",
          "the Gnosis subgraph, attestation ceremonies attended over {{count}} complete UTC days to {{to}}",
          { count: window.days, to: dayOf(window.to) },
        )
  const sefWords = sefPublishesNone
    ? sefNone
    : sefPublishesSome
      ? t("overview.validators.sefSome", "SEF's published 14-day figure, where SEF publishes one")
      : t("overview.validators.sefAll", "SEF's published 14-day figure")
  // Neither source gives any row a figure: name neither as the source, say why there is none.
  const noSefRate =
    sef.data === undefined
      ? sef.error
        ? t("overview.validators.sefListFailed", "SEF's validator list could not be read")
        : t("overview.validators.sefListLoading", "SEF's validator list has not loaded")
      : !fromSef
        ? t("overview.validators.sefListOmits", "SEF's validator list does not include these validators")
        : sefNone
  const noFigure =
    rows.state === "ready" && rows.value.length > 0 && !fromSubgraph && sefListed.every((v) => v.participationRate === null)
  const participationSource = noFigure
    ? t(
        "overview.validators.participationNone",
        "Participation: no figure is available. The Gnosis subgraph has none for these validators, and {{reason}}.",
        { reason: noSefRate },
      )
    : fromSubgraph && fromSef
      ? sefPublishesNone
        ? t("overview.validators.participationOtherRows", "Participation: {{subgraph}}; for the other rows, {{sef}}.", {
            subgraph: subgraphWords,
            sef: sefWords,
          })
        : t("overview.validators.participationMarked", "Participation: {{subgraph}}; rows marked \"{{marker}}\" use {{sef}}.", {
            subgraph: subgraphWords,
            marker: t("overview.validators.sefFile", "SEF file"),
            sef: sefWords,
          })
      : fromSubgraph
        ? t("overview.validators.participationSubgraph", "Participation: {{subgraph}}.", { subgraph: subgraphWords })
        : t("overview.validators.participationSef", "Participation: {{sef}}.", { sef: sefWords })

  return (
    <OverviewSection
      title={t("overview.validators.title", "Validators")}
      source={
        rows.state === "ready"
          ? t("overview.validators.source", "Stake: {{stake}}. {{participation}} {{rule}}", {
              stake: mainnetSource(rows.source, t),
              participation: participationSource,
              rule: participationRule(t),
            })
          : undefined
      }
    >
      {betaOnly && fromSubgraph && <BetaEndedNotice />}
      <FigureValue
        figure={rows}
        skeletonClassName="block h-48 w-full"
        format={(r) =>
          r.length === 0 ? t("overview.validators.empty", "No validator is registered yet.") : <Validators rows={tableRows(r)} />
        }
      />
    </OverviewSection>
  )
}

export function ActivityPanel() {
  const { t } = useTranslation()
  const { activity } = useRecentDays()
  const { stakers } = useNetworkTotals()
  return (
    <OverviewSection
      title={t("overview.activity.title", "Last {{count}} days", { count: RECENT_DAYS })}
      source={
        activity.state === "ready"
          ? t("overview.activity.source", "Mainnet subgraph, daily buckets since {{since}}.", { since: dayOf(activity.value.since) })
          : undefined
      }
    >
      {activity.state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          {t("overview.activity.unavailable", "Unavailable. {{reason}}", { reason: activity.reason })}
        </p>
      ) : (
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <StatRow label={t("overview.activity.stakersNow", "Stakers now")}>
            <FigureValue figure={stakers} format={(v) => v.toLocaleString("en-US")} />
          </StatRow>
          <StatRow label={t("overview.activity.stakedIn", "Staked in")}>
            <FigureValue figure={activity} format={(a) => safe(a.stakedIn)} />
          </StatRow>
          <StatRow label={t("overview.activity.withdrawn", "Withdrawn")}>
            <FigureValue figure={activity} format={(a) => safe(a.withdrawnOut)} />
          </StatRow>
          <StatRow label={t("overview.activity.rewardsClaimed", "Rewards claimed")}>
            <FigureValue figure={activity} format={(a) => safe(a.rewardsClaimed)} />
          </StatRow>
          <StatRow label={t("overview.activity.stakes", "Stakes")}>
            <FigureValue figure={activity} format={(a) => a.stakes.toLocaleString("en-US")} />
          </StatRow>
          <StatRow label={t("overview.activity.withdrawals", "Withdrawals")}>
            <FigureValue figure={activity} format={(a) => a.withdrawals.toLocaleString("en-US")} />
          </StatRow>
        </dl>
      )}
    </OverviewSection>
  )
}
