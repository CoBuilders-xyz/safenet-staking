import { request, type RequestExtendedOptions, type Variables } from "graphql-request"
import type { TypedDocumentNode } from "@graphql-typed-document-node/core"
import { SUBGRAPH_STALE_AFTER_SECONDS } from "@cobuilders/safenet-core"

/** A query that has not answered in this time counts as failed, so the page can fall back. */
export const SUBGRAPH_TIMEOUT_MS = 10_000

/** The `_meta` every overview query selects. */
export interface SubgraphMeta {
  block: { number: number; timestamp: number | null }
  hasIndexingErrors: boolean
}

/** How current one subgraph answer is. */
export interface Freshness {
  /** The last block the subgraph indexed. */
  block: number
  /** Unix seconds of that block. Null when the node does not report it. */
  blockTimestamp: number | null
  /** Seconds from that block to the moment of the query. Null when the timestamp is unknown. */
  ageSeconds: number | null
  /** When the query ran, in milliseconds. */
  checkedAt: number
  hasIndexingErrors: boolean
}

/** Why the page is not showing subgraph figures. */
export type Degradation =
  | { kind: "unconfigured" }
  | { kind: "failed"; message: string }
  | { kind: "stale"; freshness: Freshness }
  | { kind: "indexing-error"; freshness: Freshness }
  | { kind: "empty"; freshness: Freshness }

export function readFreshness(meta: SubgraphMeta, checkedAt: number): Freshness {
  const ts = meta.block.timestamp
  return {
    block: meta.block.number,
    blockTimestamp: ts,
    ageSeconds: ts === null ? null : Math.max(0, Math.floor(checkedAt / 1000) - ts),
    checkedAt,
    hasIndexingErrors: meta.hasIndexingErrors,
  }
}

/**
 * The freshness rule. An answer is current when the node reports when its last indexed block was
 * produced, that block is at most SUBGRAPH_STALE_AFTER_SECONDS old, and indexing has not failed.
 * An unknown timestamp is not current: nothing proves it is.
 */
export function assessFreshness(f: Freshness): Degradation | undefined {
  if (f.hasIndexingErrors) return { kind: "indexing-error", freshness: f }
  if (f.ageSeconds === null || f.ageSeconds > SUBGRAPH_STALE_AFTER_SECONDS) return { kind: "stale", freshness: f }
  return undefined
}

/**
 * "42 s", "12 min", "15 min 1 s", "3 h", "2 d". Under an hour the seconds are kept whenever they
 * are not zero, so an age just past the 15 min limit never reads as "15 min".
 */
export function formatAge(seconds: number): string {
  if (seconds < 120) return `${seconds} s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s === 0 ? `${m} min` : `${m} min ${s} s`
  }
  if (seconds < 172_800) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86_400)} d`
}

/** One plain sentence saying why subgraph figures are not shown. */
export function describeDegradation(d: Degradation): string {
  switch (d.kind) {
    case "unconfigured":
      return "No subgraph endpoint is configured for this build."
    case "failed":
      return "The subgraph could not be queried."
    case "indexing-error":
      return "The subgraph reports an indexing error, so it has stopped advancing."
    case "empty":
      return "The subgraph has not indexed this data yet."
    case "stale": {
      const { block, ageSeconds } = d.freshness
      const limit = formatAge(SUBGRAPH_STALE_AFTER_SECONDS)
      return ageSeconds === null
        ? `The subgraph does not report when block ${block.toLocaleString("en-US")} was produced, so its age is unknown.`
        : `The subgraph's last indexed block, ${block.toLocaleString("en-US")}, is ${formatAge(ageSeconds)} old, past the ${limit} limit.`
    }
  }
}

/** An abort signal that fires on the caller's signal or after `ms`, whichever comes first. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`no answer within ${ms} ms`)), ms)
  signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
  return controller.signal
}

export interface SubgraphAnswer<T> {
  data: T
  freshness: Freshness
}

/**
 * One query, with its freshness read from the `_meta` of the same response. Throws when the
 * response carries no `_meta`, because then nothing says how current the data is.
 */
export async function fetchSubgraph<T extends { _meta: SubgraphMeta | null }, V extends Variables>(
  url: string,
  document: TypedDocumentNode<T, V>,
  variables: V | undefined,
  signal?: AbortSignal,
): Promise<SubgraphAnswer<T>> {
  // graphql-request types `variables` as optional or required depending on V, which a generic V
  // cannot satisfy. The documents' own types already bind variables to the query.
  const options = {
    url,
    document,
    variables,
    signal: withTimeout(signal, SUBGRAPH_TIMEOUT_MS),
  } as unknown as RequestExtendedOptions<V, T>
  const data = await request<T, V>(options)
  if (!data._meta) throw new Error("The subgraph answered without _meta")
  return { data, freshness: readFreshness(data._meta, Date.now()) }
}
