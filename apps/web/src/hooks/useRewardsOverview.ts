import { useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { MESSAGES } from "@/components/rewards/messages"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { useNetworkQuery } from "./useNetworkTotals"
import { selectLive } from "./useSubgraphQuery"

export const REWARDS_MESSAGES = {
  rootDiffers:
    "The root on chain differs from the one SEF published, so the published allocation does not match what the contract pays out.",
  claimsExceedAllocation: "Claims exceed the published allocation, so the difference does not measure what is unclaimed.",
  negativeClaims: "The subgraph reports a negative claimed total, which cannot be right.",
  balanceExceedsAllocation:
    "The contract holds more SAFE than the published allocation, so the difference does not measure claims.",
} as const

/**
 * Rewards allocated, claimed and unclaimed, with the on-chain root check.
 *
 * Allocated is always SEF's published total, behind the root it published; nothing on chain
 * records it. Claimed comes from the Mainnet subgraph's sum of Claimed events while it is live,
 * and unclaimed is allocated minus that. Otherwise both come from the MerkleDrop's live balance,
 * as on the Rewards page. Either way they are derived only while the contract holds the published
 * root.
 */
export function useRewardsOverview() {
  const subgraph = useNetworkQuery()
  const network = selectLive(subgraph, (d) => d.network)
  const programme = useProgrammeRewards()
  const { latest, onChainRoot, dropBalance, totals, rootMatches } = programme

  const allocated: Figure<bigint> = latest.error
    ? unavailable(MESSAGES.latestFileFailed)
    : latest.data
      ? ready(BigInt(latest.data.tokenTotal), "sef")
      : loading()

  let claimed: Figure<bigint> = loading()
  let unclaimed: Figure<bigint> = loading()

  if (network.status === "live") {
    const sum = BigInt(network.value.rewardsClaimed)
    claimed = sum < 0n ? unavailable(REWARDS_MESSAGES.negativeClaims) : ready(sum, "subgraph")
    if (sum < 0n) unclaimed = unavailable(REWARDS_MESSAGES.negativeClaims)
    else if (allocated.state !== "ready") unclaimed = allocated
    else if (onChainRoot.error) unclaimed = unavailable(MESSAGES.contractReadFailed)
    else if (rootMatches === undefined) unclaimed = loading()
    else if (!rootMatches) unclaimed = unavailable(REWARDS_MESSAGES.rootDiffers)
    else if (sum > allocated.value) unclaimed = unavailable(REWARDS_MESSAGES.claimsExceedAllocation)
    else unclaimed = ready(allocated.value - sum, "subgraph")
  } else if (network.status === "degraded") {
    let fallback: Figure<{ claimed: bigint; unclaimed: bigint }>
    if (onChainRoot.error || dropBalance.error) fallback = unavailable(MESSAGES.contractReadFailed)
    else if (latest.error) fallback = unavailable(MESSAGES.latestFileFailed)
    else if (rootMatches === false) fallback = unavailable(REWARDS_MESSAGES.rootDiffers)
    else if (!totals) fallback = loading()
    else if (totals.claimed === undefined) fallback = unavailable(REWARDS_MESSAGES.balanceExceedsAllocation)
    else fallback = ready({ claimed: totals.claimed, unclaimed: totals.unclaimed }, "contract")

    claimed = fallback.state === "ready" ? ready(fallback.value.claimed, "contract") : fallback
    unclaimed = fallback.state === "ready" ? ready(fallback.value.unclaimed, "contract") : fallback
  }

  return { subgraph, programme, allocated, claimed, unclaimed, rootMatches }
}
