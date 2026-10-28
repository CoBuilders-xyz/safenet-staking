import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { useNetworkQuery } from "./useNetworkTotals"
import { selectLive } from "./useSubgraphQuery"

/**
 * The reasons a rewards figure on the overview is unavailable, in the current language. The first
 * two say the same as the Rewards page's MESSAGES in components/rewards/messages.ts.
 */
export const rewardsMessages = (t: TFunction) => ({
  latestFileFailed: t("overview.reason.latestFileFailed", "SEF's published rewards file could not be loaded."),
  contractReadFailed: t("overview.reason.merkleDropReadFailed", "The MerkleDrop contract could not be read from Ethereum."),
  rootDiffers: t(
    "overview.reason.rootDiffers",
    "The root on chain differs from the one SEF published, so the published allocation does not match what the contract pays out.",
  ),
  claimsExceedAllocation: t(
    "overview.reason.claimsExceedAllocation",
    "Claims exceed the published allocation, so the difference does not measure what is unclaimed.",
  ),
  negativeClaims: t("overview.reason.negativeClaims", "The subgraph reports a negative claimed total, which cannot be right."),
  balanceExceedsAllocation: t(
    "overview.reason.balanceExceedsAllocation",
    "The contract holds more SAFE than the published allocation, so the difference does not measure claims.",
  ),
})

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
  const { t } = useTranslation()
  const messages = rewardsMessages(t)
  const subgraph = useNetworkQuery()
  const network = selectLive(subgraph, (d) => d.network)
  const programme = useProgrammeRewards()
  const { latest, onChainRoot, dropBalance, totals, rootMatches } = programme

  const allocated: Figure<bigint> = latest.error
    ? unavailable(messages.latestFileFailed)
    : latest.data
      ? ready(BigInt(latest.data.tokenTotal), "sef")
      : loading()

  let claimed: Figure<bigint> = loading()
  let unclaimed: Figure<bigint> = loading()

  if (network.status === "live") {
    const sum = BigInt(network.value.rewardsClaimed)
    claimed = sum < 0n ? unavailable(messages.negativeClaims) : ready(sum, "subgraph")
    if (sum < 0n) unclaimed = unavailable(messages.negativeClaims)
    else if (allocated.state !== "ready") unclaimed = allocated
    else if (onChainRoot.error) unclaimed = unavailable(messages.contractReadFailed)
    else if (rootMatches === undefined) unclaimed = loading()
    else if (!rootMatches) unclaimed = unavailable(messages.rootDiffers)
    else if (sum > allocated.value) unclaimed = unavailable(messages.claimsExceedAllocation)
    else unclaimed = ready(allocated.value - sum, "subgraph")
  } else if (network.status === "degraded") {
    let fallback: Figure<{ claimed: bigint; unclaimed: bigint }>
    if (onChainRoot.error || dropBalance.error) fallback = unavailable(messages.contractReadFailed)
    else if (latest.error) fallback = unavailable(messages.latestFileFailed)
    else if (rootMatches === false) fallback = unavailable(messages.rootDiffers)
    else if (!totals) fallback = loading()
    else if (totals.claimed === undefined) fallback = unavailable(messages.balanceExceedsAllocation)
    else fallback = ready({ claimed: totals.claimed, unclaimed: totals.unclaimed }, "contract")

    claimed = fallback.state === "ready" ? ready(fallback.value.claimed, "contract") : fallback
    unclaimed = fallback.state === "ready" ? ready(fallback.value.unclaimed, "contract") : fallback
  }

  return { subgraph, programme, allocated, claimed, unclaimed, rootMatches }
}
