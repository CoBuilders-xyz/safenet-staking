import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { StakeHistoryDocument } from "@/graphql/mainnet/generated"
import { estimateApr, type AprEstimate, type AprUnavailable } from "@/lib/estimatedApr"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { describeDegradation } from "@/lib/subgraph"
import { useProgrammeRewards } from "./useProgrammeRewards"
import { useSubgraphQuery } from "./useSubgraphQuery"

export type AprFigure = Extract<AprEstimate, { ok: true }>

/** Why the estimate is not shown, one sentence per reason, in the current language. */
export const aprMessages = (t: TFunction): Record<AprUnavailable, string> => ({
  invalidAmount: t("overview.apr.reason.invalidAmount", "An amount in SEF's rewards file or the subgraph is not a whole number of wei."),
  invalidPeriodEnd: t("overview.apr.reason.invalidPeriodEnd", "SEF's rewards file does not end its period at a UTC midnight."),
  periodInFuture: t("overview.apr.reason.periodInFuture", "SEF's rewards file names a reward period that has not ended yet."),
  noPeriodYet: t("overview.apr.reason.noPeriodYet", "The rewards file read holds no complete Aegis reward period yet."),
  misalignedPeriod: t("overview.apr.reason.misalignedPeriod", "SEF's rewards file ends at a date that is not a reward period boundary."),
  stale: t("overview.apr.reason.stale", "SEF's latest reward period ended too long ago to describe the current rate."),
  noSentinelTotal: t("overview.apr.reason.noSentinelTotal", "SEF's rewards file does not separate sentinel rewards from staker rewards."),
  noRewards: t("overview.apr.reason.noRewards", "SEF's rewards file shows no staker rewards for Aegis."),
  outsideBudget: t(
    "overview.apr.reason.outsideBudget",
    "SEF's published staker rewards differ from the allocation per reward period, so the method behind this estimate no longer holds.",
  ),
  notIndexed: t("overview.apr.reason.notIndexed", "The Mainnet subgraph has not indexed the end of the reward period yet."),
  noStakeBeforePeriod: t("overview.apr.reason.noStakeBeforePeriod", "The Mainnet subgraph holds no total staked from the start of the reward period."),
  noStake: t("overview.apr.reason.noStake", "No SAFE was staked during the reward period."),
})

/**
 * The estimated APR for the overview: SEF's rewards file, read as everywhere else, and the
 * Mainnet subgraph's daily totals, from the same query as the stake chart. The method is
 * `estimateApr` in lib/estimatedApr.ts.
 */
export function useEstimatedApr(): Figure<AprFigure> {
  const { t } = useTranslation()
  const { latest } = useProgrammeRewards()
  const history = useSubgraphQuery("mainnet", "stake-history", StakeHistoryDocument)

  if (latest.error) return unavailable(t("overview.reason.latestFileFailed", "SEF's published rewards file could not be loaded."))
  if (history.status === "degraded") {
    return unavailable(
      t("overview.apr.reason.noDailyStake", "{{why}} The estimate needs the subgraph's daily total staked.", {
        why: describeDegradation(history.degradation, t),
      }),
    )
  }
  if (!latest.data || history.status === "loading") return loading()

  const estimate = estimateApr({
    latest: latest.data,
    days: history.data.dayDatas,
    indexedAt: history.freshness.blockTimestamp ?? undefined,
    // When the subgraph answered, refreshed with every answer: render stays pure, and an open
    // page still sees the file go stale.
    now: history.freshness.checkedAt,
  })
  return estimate.ok ? ready(estimate, "sef") : unavailable(aprMessages(t)[estimate.reason])
}
