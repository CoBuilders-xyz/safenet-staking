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

/** Validators by SEF's `is_active` flag. */
export interface ValidatorCounts {
  active: number
  /** Listed with `is_active: false`: withdrawn, with Aegis participation unconfirmed. */
  withdrawn: number
}

/**
 * Network-wide staking figures: total staked, validators, current stakers.
 *
 * Total staked and stakers come from the Mainnet subgraph while it is live. Otherwise total staked
 * comes from `totalStakedAmount()` on the staking contract, and stakers, which no contract read
 * gives, is unavailable with the reason. Validators always come from SEF's list: only its
 * `is_active` flag says which validators still take part, while the contract and the subgraph
 * count every registered one.
 */
export function useNetworkTotals() {
  const subgraph = useNetworkQuery()
  const network = selectLive(subgraph, (d) => d.network)
  const degraded = network.status === "degraded"
  const totalRead = useTotalStaked({ enabled: degraded })
  const validators = useValidators()

  let totalStaked: Figure<bigint> = loading()
  let stakers: Figure<number> = loading()
  const validatorCounts: Figure<ValidatorCounts> = validators.error
    ? unavailable(NETWORK_MESSAGES.validatorListFailed)
    : validators.data
      ? ready(
          {
            active: validators.data.filter((v) => v.isActive).length,
            withdrawn: validators.data.filter((v) => !v.isActive).length,
          },
          "sef",
        )
      : loading()

  if (network.status === "live") {
    totalStaked = ready(BigInt(network.value.totalStaked), "subgraph")
    stakers = ready(network.value.stakersCurrent, "subgraph")
  } else if (network.status === "degraded") {
    totalStaked = fromRead(totalRead, "contract", NETWORK_MESSAGES.stakingReadFailed)
    stakers = unavailable(`${describeDegradation(network.degradation)} No contract read gives this figure.`)
  }

  return { subgraph, totalStaked, validatorCounts, stakers }
}
