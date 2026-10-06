import { NetworkTotalsDocument } from "@/graphql/mainnet/generated"
import { useTotalStaked } from "@/hooks/useStakingReads"
import { useValidators } from "@/hooks/useValidators"
import { describeDegradation } from "@/lib/subgraph"
import { fromRead, loading, ready, unavailable, type Figure } from "@/lib/figure"
import { selectLive, useSubgraphQuery } from "./useSubgraphQuery"

export const NETWORK_MESSAGES = {
  stakingReadFailed: "The staking contract could not be read from Ethereum.",
  validatorListFailed: "SEF's validator list could not be loaded.",
} as const

/** The query the network totals and the rewards figures share. One request serves both. */
export function useNetworkQuery() {
  return useSubgraphQuery("mainnet", "network", NetworkTotalsDocument)
}

/**
 * Network-wide staking figures: total staked, active validators, current stakers.
 *
 * From the Mainnet subgraph while it is live. Otherwise total staked comes from
 * `totalStakedAmount()` on the staking contract, active validators from SEF's validator list, and
 * stakers, which no contract read gives, is unavailable with the reason.
 */
export function useNetworkTotals() {
  const subgraph = useNetworkQuery()
  const network = selectLive(subgraph, (d) => d.network)
  const degraded = network.status === "degraded"
  const totalRead = useTotalStaked({ enabled: degraded })
  const validators = useValidators()

  let totalStaked: Figure<bigint> = loading()
  let activeValidators: Figure<number> = loading()
  let stakers: Figure<number> = loading()

  if (network.status === "live") {
    totalStaked = ready(BigInt(network.value.totalStaked), "subgraph")
    activeValidators = ready(network.value.activeValidators, "subgraph")
    stakers = ready(network.value.stakersCurrent, "subgraph")
  } else if (network.status === "degraded") {
    totalStaked = fromRead(totalRead, "contract", NETWORK_MESSAGES.stakingReadFailed)
    activeValidators = validators.error
      ? unavailable(NETWORK_MESSAGES.validatorListFailed)
      : validators.data
        ? ready(validators.data.filter((v) => v.isActive).length, "sef")
        : loading()
    stakers = unavailable(`${describeDegradation(network.degradation)} No contract read gives this figure.`)
  }

  return { subgraph, totalStaked, activeValidators, stakers }
}
