import { useQuery } from "@tanstack/react-query"
import type { Variables } from "graphql-request"
import type { TypedDocumentNode } from "@graphql-typed-document-node/core"
import type { ChainKey } from "@cobuilders/safenet-core"
import { SUBGRAPH_URLS } from "@/config/subgraphs"
import {
  assessFreshness,
  fetchSubgraph,
  type Degradation,
  type Freshness,
  type SubgraphMeta,
} from "@/lib/subgraph"

/** How often a subgraph is asked again. Both chains produce several blocks in this time. */
const REFETCH_MS = 60_000

/**
 * The state of one subgraph query.
 *
 * `live` means the answer passed the freshness rule and may be shown. `degraded` means it may not,
 * and says why; it still carries the answer, if there was one, so a screen can show its
 * freshness.
 */
export type SubgraphResult<T> =
  | { status: "loading" }
  | { status: "live"; data: T; freshness: Freshness }
  | { status: "degraded"; degradation: Degradation; data?: T; freshness?: Freshness }

/**
 * Query a subgraph through TanStack Query, with freshness on every answer.
 *
 * `variables` is a function so a rolling window, such as "since 30 days ago", is computed when
 * the query runs rather than when the component renders.
 */
export function useSubgraphQuery<T extends { _meta: SubgraphMeta | null }, V extends Variables>(
  chain: ChainKey,
  name: string,
  document: TypedDocumentNode<T, V>,
  variables?: () => V,
): SubgraphResult<T> {
  const url = SUBGRAPH_URLS[chain]
  const query = useQuery({
    queryKey: ["subgraph", chain, name, url],
    queryFn: ({ signal }) => fetchSubgraph(url as string, document, variables?.(), signal),
    enabled: url !== undefined,
    refetchInterval: REFETCH_MS,
    retry: 1,
  })

  if (url === undefined) return { status: "degraded", degradation: { kind: "unconfigured" } }
  if (query.error) {
    return {
      status: "degraded",
      degradation: { kind: "failed", message: query.error.message },
      data: query.data?.data,
      freshness: query.data?.freshness,
    }
  }
  if (!query.data) return { status: "loading" }
  const { data, freshness } = query.data
  const degradation = assessFreshness(freshness)
  return degradation ? { status: "degraded", degradation, data, freshness } : { status: "live", data, freshness }
}

/**
 * Narrow a live result to the part a hook needs. A live answer without that part, for example a
 * subgraph that has not indexed its first event, degrades as `empty`.
 */
export function selectLive<T, U>(
  result: SubgraphResult<T>,
  pick: (data: T) => U | null | undefined,
): { status: "loading" } | { status: "live"; value: U; freshness: Freshness } | { status: "degraded"; degradation: Degradation } {
  if (result.status === "loading") return result
  if (result.status === "degraded") return { status: "degraded", degradation: result.degradation }
  const value = pick(result.data)
  if (value === null || value === undefined) {
    return { status: "degraded", degradation: { kind: "empty", freshness: result.freshness } }
  }
  return { status: "live", value, freshness: result.freshness }
}
