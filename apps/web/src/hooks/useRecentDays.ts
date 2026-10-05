import { RecentDaysDocument, type RecentDaysQuery } from "@/graphql/mainnet/generated"
import { utcDayStart } from "@/lib/consensus"
import { describeDegradation } from "@/lib/subgraph"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { selectLive, useSubgraphQuery } from "./useSubgraphQuery"

export const RECENT_MESSAGES = {
  negative: "The subgraph reports a negative daily amount, which cannot be right.",
} as const

/** The activity window on the overview, in UTC days, today included. */
export const RECENT_DAYS = 30

const DAY_SECONDS = 86_400

export interface RecentActivity {
  /** Unix seconds of the first day in the window. */
  since: number
  /** Days with activity. A quiet day has no row: the subgraph writes one only when an event lands. */
  days: RecentDaysQuery["dayDatas"]
  stakedIn: bigint
  withdrawnOut: bigint
  rewardsClaimed: bigint
  stakes: number
  withdrawals: number
}

const windowStart = (ms: number) => utcDayStart(ms) - (RECENT_DAYS - 1) * DAY_SECONDS

/**
 * Staking activity over the last RECENT_DAYS days, from the Mainnet subgraph's daily buckets.
 *
 * No contract read gives a daily history, so when the subgraph is not live this is unavailable,
 * with the reason.
 */
export function useRecentDays() {
  const subgraph = useSubgraphQuery("mainnet", "recent-days", RecentDaysDocument, () => ({ since: windowStart(Date.now()) }))
  const live = selectLive(subgraph, (d) => d.dayDatas)

  let activity: Figure<RecentActivity> = loading()
  if (live.status === "live") {
    const days = live.value
    const negative = days.some((d) => BigInt(d.stakedIn) < 0n || BigInt(d.withdrawnOut) < 0n || BigInt(d.rewardsClaimed) < 0n)
    activity = negative ? unavailable(RECENT_MESSAGES.negative) : ready(
      {
        since: windowStart(live.freshness.checkedAt),
        days,
        stakedIn: days.reduce((sum, d) => sum + BigInt(d.stakedIn), 0n),
        withdrawnOut: days.reduce((sum, d) => sum + BigInt(d.withdrawnOut), 0n),
        rewardsClaimed: days.reduce((sum, d) => sum + BigInt(d.rewardsClaimed), 0n),
        stakes: days.reduce((sum, d) => sum + d.stakeCount, 0),
        withdrawals: days.reduce((sum, d) => sum + d.withdrawalCount, 0),
      },
      "subgraph",
    )
  } else if (live.status === "degraded") {
    activity = unavailable(`${describeDegradation(live.degradation)} No contract read gives a daily history.`)
  }

  return { subgraph, activity }
}
