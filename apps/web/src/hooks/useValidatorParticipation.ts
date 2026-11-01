import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ValidatorParticipationDocument, type ValidatorParticipationQuery } from "@/graphql/gnosis/generated"
import { SUBGRAPH_URLS } from "@/config/subgraphs"
import { assessFreshness, describeDegradation, fetchSubgraph, type SubgraphAnswer } from "@/lib/subgraph"
import { loading, ready, unavailable, type Figure } from "@/lib/figure"
import { seriesFromAnswer, type ValidatorSeries } from "@/lib/participationSeries"

const LISTS = ["consensusDays", "validatorDays", "consensusHours", "validatorHours"] as const

/** All participation buckets, with unique cursors and the first answer's block on later pages. */
export async function fetchValidatorParticipation(url: string, address: string, signal?: AbortSignal): Promise<SubgraphAnswer<ValidatorParticipationQuery>> {
  const variables = { validator: address.toLowerCase(), daysAfter: "", validatorDaysAfter: "", hoursAfter: "", validatorHoursAfter: "" }
  const first = await fetchSubgraph(url, ValidatorParticipationDocument, variables, signal)
  const data = { ...first.data }
  let page = first.data
  for (let n = 1; LISTS.some((key) => page[key].length === 1000); n++) {
    if (n >= 20) throw new Error("Participation exceeds 20 pages")
    const next = await fetchSubgraph(url, ValidatorParticipationDocument, {
      ...variables,
      block: { number: first.freshness.block },
      daysAfter: data.consensusDays.at(-1)?.id ?? "",
      validatorDaysAfter: data.validatorDays.at(-1)?.id ?? "",
      hoursAfter: data.consensusHours.at(-1)?.id ?? "",
      validatorHoursAfter: data.validatorHours.at(-1)?.id ?? "",
    }, signal)
    if (next.freshness.block !== first.freshness.block || next.freshness.hasIndexingErrors) throw new Error("Inconsistent participation page")
    page = next.data
    data.consensusDays = [...data.consensusDays, ...page.consensusDays]
    data.validatorDays = [...data.validatorDays, ...page.validatorDays]
    data.consensusHours = [...data.consensusHours, ...page.consensusHours]
    data.validatorHours = [...data.validatorHours, ...page.validatorHours]
  }
  return { data, freshness: first.freshness }
}

/** Fresh, complete participation history. Incomplete membership or counts never become a zero rate. */
export function useValidatorParticipation(address: string) {
  const { t } = useTranslation()
  const url = SUBGRAPH_URLS.gnosis
  const query = useQuery({
    queryKey: ["subgraph", "gnosis", "validator-participation", address.toLowerCase(), url],
    queryFn: async ({ signal }) => {
      try {
        const answer = await fetchValidatorParticipation(url as string, address, signal)
        const series = seriesFromAnswer(answer.data, answer.freshness.blockTimestamp ?? 0, address)
        return { ok: true as const, ...answer, series }
      } catch {
        return { ok: false as const }
      }
    },
    enabled: url !== undefined,
    refetchInterval: 60_000,
    retry: false,
  })
  let series: Figure<ValidatorSeries> = loading()
  if (!url) series = unavailable(describeDegradation({ kind: "unconfigured" }, t))
  else if (query.data?.ok === false) series = unavailable(t("selector.incompleteHistory", "The subgraph could not provide complete, consistent history."))
  else if (query.data?.ok) {
    const degradation = assessFreshness(query.data.freshness)
    series = degradation ? unavailable(describeDegradation(degradation, t)) : ready(query.data.series, "subgraph")
  }
  return { series }
}
