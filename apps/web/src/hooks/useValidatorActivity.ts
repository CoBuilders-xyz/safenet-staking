import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { ValidatorActivityDocument, type ValidatorActivityQuery } from "@/graphql/mainnet/generated"
import { SUBGRAPH_URLS } from "@/config/subgraphs"
import { assessFreshness, describeDegradation, fetchSubgraph, type SubgraphAnswer } from "@/lib/subgraph"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import {
  buildHistory,
  delegatorSeries,
  type DelegatorSeries,
  type StakeRow,
  type ValidatorEvent,
  type ValidatorRow,
  type WithdrawalRow,
} from "@/lib/validatorActivity"
import type { SubgraphResult } from "./useSubgraphQuery"

/** graph-node caps `first` at 1000. */
const PAGE = 1000

/** Pages read before giving up. 20,000 events per list, far above Safenet's whole history. */
const MAX_PAGES = 20

export interface ActivityData {
  _meta: ValidatorActivityQuery["_meta"]
  validator: ValidatorRow | null
  stakes: StakeRow[]
  withdrawals: WithdrawalRow[]
}

/**
 * Every stake and withdrawal one validator received, read page by page. The first page answers at
 * the head; the others are read at the block it answered at, so the lists and the validator's own
 * counters describe the same block. Studio keeps about 1,000 blocks of history, hours on Mainnet,
 * far longer than the pages take.
 */
export async function fetchValidatorActivity(url: string, address: string, signal?: AbortSignal): Promise<SubgraphAnswer<ActivityData>> {
  const id = address.toLowerCase()
  const first = await fetchSubgraph(url, ValidatorActivityDocument, { id, validator: id, stakesAfter: "", withdrawalsAfter: "" }, signal)
  const stakes = [...first.data.stakes]
  const withdrawals = [...first.data.withdrawals]
  let more = { stakes: first.data.stakes.length === PAGE, withdrawals: first.data.withdrawals.length === PAGE }
  for (let page = 1; more.stakes || more.withdrawals; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of activity`)
    const next = await fetchSubgraph(
      url,
      ValidatorActivityDocument,
      {
        id,
        validator: id,
        block: { number: first.freshness.block },
        stakesAfter: stakes[stakes.length - 1]?.id ?? "",
        withdrawalsAfter: withdrawals[withdrawals.length - 1]?.id ?? "",
      },
      signal,
    )
    if (next.freshness.block !== first.freshness.block || next.freshness.hasIndexingErrors) throw new Error("Inconsistent activity page")
    // A list already complete answers its next page empty, so only the unfinished one grows.
    if (more.stakes) stakes.push(...next.data.stakes)
    if (more.withdrawals) withdrawals.push(...next.data.withdrawals)
    more = {
      stakes: more.stakes && next.data.stakes.length === PAGE,
      withdrawals: more.withdrawals && next.data.withdrawals.length === PAGE,
    }
  }
  return { data: { _meta: first.data._meta, validator: first.data.validator ?? null, stakes, withdrawals }, freshness: first.freshness }
}

export interface ValidatorActivity {
  /** Null when the subgraph has no record of the address. */
  validator: ValidatorRow | null
  /** Newest first. */
  history: ValidatorEvent[]
  delegators: DelegatorSeries
  /**
   * True when the replayed counts equal the validator's own counters in the subgraph. False would
   * mean the lists are incomplete, so the series is not shown.
   */
  replayMatches: boolean
  /** The block every list was read at, and its unix seconds. */
  block: number
  indexedAt: number
}

/**
 * One validator's history and delegators over time, from the Mainnet subgraph. Like
 * `useSubgraphQuery`, the query function returns a failure as data rather than throwing, so a
 * refetch never reads as loading.
 */
export function useValidatorActivity(address: string) {
  const { t } = useTranslation()
  const url = SUBGRAPH_URLS.mainnet
  const query = useQuery({
    queryKey: ["subgraph", "mainnet", "validator-activity", address.toLowerCase(), url],
    queryFn: async ({ signal }) => {
      try {
        return { ok: true as const, answer: await fetchValidatorActivity(url as string, address, signal) }
      } catch (e) {
        return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
      }
    },
    enabled: url !== undefined,
    refetchInterval: 5 * 60_000,
    retry: false,
  })

  let subgraph: SubgraphResult<ActivityData> = { status: "loading" }
  if (url === undefined) subgraph = { status: "degraded", degradation: { kind: "unconfigured" } }
  else if (query.data && !query.data.ok) subgraph = { status: "degraded", degradation: { kind: "failed", message: query.data.message } }
  else if (query.data?.ok) {
    const { data, freshness } = query.data.answer
    const degradation = assessFreshness(freshness)
    subgraph = degradation ? { status: "degraded", degradation, data, freshness } : { status: "live", data, freshness }
  }

  let activity: Figure<ValidatorActivity> = loading()
  if (subgraph.status === "degraded") activity = unavailable(describeDegradation(subgraph.degradation, t))
  if (subgraph.status === "live") {
    const { validator, stakes, withdrawals } = subgraph.data
    const delegators = delegatorSeries(stakes, withdrawals)
    activity = ready(
      {
        validator,
        history: buildHistory(validator, stakes, withdrawals),
        delegators,
        replayMatches:
          validator !== null && delegators.current === validator.stakersCurrent && delegators.ever === validator.stakersEver,
        block: subgraph.freshness.block,
        indexedAt: subgraph.freshness.blockTimestamp ?? 0,
      },
      "subgraph",
    )
  }
  return { subgraph, activity }
}
