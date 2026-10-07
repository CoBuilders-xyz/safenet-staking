import { useMemo } from "react"
import { getAddress, type Address } from "viem"
import { ValidatorStakesDocument } from "@/graphql/mainnet/generated"
import { useValidatorTotalStakes } from "@/hooks/useStakingReads"
import { findValidator, useValidators } from "@/hooks/useValidators"
import { withShares } from "@/lib/distribution"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { NETWORK_MESSAGES } from "./useNetworkTotals"
import { selectLive, useSubgraphQuery } from "./useSubgraphQuery"

export interface ValidatorStakeRow {
  address: Address
  /** SEF's label. Undefined until the list loads, or for a validator it does not list. */
  label: string | undefined
  stake: bigint
  /** Fraction of all stake, to six decimals. */
  share: number
  /** Addresses staking with this validator now. Only the subgraph has it. */
  stakers: number | undefined
}

/**
 * Registered validators with their stake and share, largest first.
 *
 * From the Mainnet subgraph while it is live. Otherwise the validators are SEF's list, withdrawn
 * ones included because their stake is still staked, and each stake is `totalValidatorStakes()` on
 * the staking contract. Shares need every stake, so a
 * single failed read makes the whole distribution unavailable rather than wrong.
 */
export function useValidatorStakes() {
  const subgraph = useSubgraphQuery("mainnet", "validators", ValidatorStakesDocument)
  const live = selectLive(subgraph, (d) => (d.validators.length > 0 ? d.validators : undefined))
  const degraded = live.status === "degraded"
  const sef = useValidators()
  const sefListed = useMemo(() => sef.data?.map((v) => v.address) ?? [], [sef.data])
  const reads = useValidatorTotalStakes(sefListed, { enabled: degraded })

  let rows: Figure<ValidatorStakeRow[]> = loading()

  if (live.status === "live") {
    rows = ready(
      sortByStake(
        withShares(
          live.value.map((v) => ({
            address: getAddress(v.id),
            label: findValidator(sef.data, v.id)?.label,
            stake: BigInt(v.totalStaked),
            stakers: v.stakersCurrent,
          })),
        ),
      ),
      "subgraph",
    )
  } else if (degraded) {
    if (sef.error) {
      rows = unavailable(`${NETWORK_MESSAGES.validatorListFailed} Without it there is no list of validators to read stakes for.`)
    } else if (!sef.data) {
      rows = loading()
    } else if (sefListed.length === 0) {
      rows = ready([], "contract")
    } else if (reads.error) {
      rows = unavailable(NETWORK_MESSAGES.stakingReadFailed)
    } else if (!reads.data) {
      rows = loading()
    } else {
      const failed = reads.data.filter((r) => r.status !== "success" || typeof r.result !== "bigint").length
      rows =
        failed > 0
          ? unavailable(`${failed} of ${reads.data.length} validator stakes could not be read, so shares would be wrong.`)
          : ready(
              sortByStake(
                withShares(
                  sefListed.map((address, i) => ({
                    address,
                    label: findValidator(sef.data, address)?.label,
                    stake: reads.data[i].result as bigint,
                    stakers: undefined,
                  })),
                ),
              ),
              "contract",
            )
    }
  }

  return { subgraph, rows }
}

function sortByStake<T extends { stake: bigint }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.stake === b.stake ? 0 : a.stake > b.stake ? -1 : 1))
}
