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
  type SubgraphAnswer,
  type SubgraphMeta,
} from "@/lib/subgraph"

type Outcome<T> = { ok: true; answer: SubgraphAnswer<T> } | { ok: false; message: string }

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
  // The query function never throws: a failure is returned as data. TanStack Query clears the
  // error of a query that has no data each time it refetches, so a thrown failure would read as
  // "loading" for the length of every refetch, and the contract fallbacks would switch off with
  // it. Returned as data, the last outcome stays until the next one replaces it. It also means
  // no retry: a subgraph that does not answer in SUBGRAPH_TIMEOUT_MS degrades at once.
  const query = useQuery({
    queryKey: ["subgraph", chain, name, url],
    queryFn: async ({ signal }): Promise<Outcome<T>> => {
      try {
        return { ok: true, answer: await fetchSubgraph(url as string, document, variables?.(), signal) }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
    enabled: url !== undefined,
    refetchInterval: REFETCH_MS,
    retry: false,
  })

  if (url === undefined) return { status: "degraded", degradation: { kind: "unconfigured" } }
  if (!query.data) return { status: "loading" }
  if (!query.data.ok) return { status: "degraded", degradation: { kind: "failed", message: query.data.message } }
  const { data, freshness } = query.data.answer
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
