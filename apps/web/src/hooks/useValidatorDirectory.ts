import { useTranslation } from "react-i18next"
import { ValidatorDirectoryDocument } from "@/graphql/mainnet/generated"
import { describeDegradation } from "@/lib/subgraph"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { selectLive, useSubgraphQuery } from "./useSubgraphQuery"

export interface DirectoryEntry {
  /** The Staking contract's flag, from its latest ValidatorUpdated event. */
  isRegistered: boolean
  /** Addresses with a non-zero position now. */
  delegators: number
  /** Addresses that have ever staked with it. */
  delegatorsEver: number
  /** The block and unix seconds of its latest registration. Undefined before one is indexed. */
  registeredAt: { block: bigint; timestamp: number } | undefined
}

/**
 * Every validator the Mainnet subgraph knows, by lowercase address: delegators and registration
 * for the validators list. Unavailable, with the reason, while the subgraph is not live.
 */
export function useValidatorDirectory() {
  const { t } = useTranslation()
  const subgraph = useSubgraphQuery("mainnet", "validator-directory", ValidatorDirectoryDocument)
  const live = selectLive(subgraph, (d) => (d.validators.length > 0 ? d.validators : undefined))

  let entries: Figure<Map<string, DirectoryEntry>> = loading()
  if (live.status === "degraded") entries = unavailable(describeDegradation(live.degradation, t))
  if (live.status === "live" && live.value.length >= 1000) {
    entries = unavailable(t("selector.incompleteHistory", "The subgraph could not provide complete, consistent history."))
  } else if (live.status === "live") {
    entries = ready(
      new Map(
        live.value.map((v) => [
          v.id.toLowerCase(),
          {
            isRegistered: v.isRegistered,
            delegators: v.stakersCurrent,
            delegatorsEver: v.stakersEver,
            registeredAt:
              v.registeredAtBlock && v.registeredAtTimestamp
                ? { block: BigInt(v.registeredAtBlock), timestamp: Number(v.registeredAtTimestamp) }
                : undefined,
          },
        ]),
      ),
      "subgraph",
    )
  }
  return { subgraph, entries }
}
