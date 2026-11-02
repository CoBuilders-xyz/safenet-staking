import { SUBGRAPH_STALE_AFTER_SECONDS } from "@cobuilders/safenet-core"

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: 400 | 404 | 500 | 502 | 503 | 504, message: string) {
    super(message)
  }
}
export type Fetcher = typeof fetch
export interface Freshness {
  source: string
  checkedAt: string
  block: number
  blockHash: string
  blockTimestamp: number
  ageSeconds: number
}
export interface Result<T> {
  data: T
  sources: unknown[]
  expiresAt: number
}
export const malformed = () => new ApiError("invalid_upstream", 502, "An upstream returned invalid data.")
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw malformed()
  return value as Record<string, unknown>
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw malformed()
  return value
}
export function string(value: unknown): string {
  if (typeof value !== "string") throw malformed()
  return value
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw malformed()
  return value
}
export function uint(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw malformed()
  return value
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw malformed()
  return value
}
export async function json(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(6000) })
    if (!response.ok) throw new ApiError("upstream_failed", 502, "An upstream request failed.")
    // Bound memory even when an upstream sends no Content-Length.
    const reader = response.body?.getReader()
    if (!reader) throw malformed()
    const decoder = new TextDecoder()
    let text = "", size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2_000_000) throw malformed()
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
      return JSON.parse(text) as unknown
    } finally {
      await reader.cancel()
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new ApiError("upstream_timeout", 504, "An upstream request timed out.")
    }
    throw new ApiError("upstream_failed", 502, "An upstream request failed.")
  }
}
export const META = "_meta { block { number hash timestamp } hasIndexingErrors }"
export async function graph(
  fetcher: Fetcher, url: string, query: string, variables: Record<string, unknown>,
  now: number, source: string, pinnedHash?: string,
): Promise<{ data: Record<string, unknown>; freshness: Freshness; expiresAt: number }> {
  if (!url) throw new ApiError("unconfigured", 503, "A subgraph endpoint is not configured.")
  const answer = object(await json(fetcher, url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }),
  }))
  if (answer.errors !== undefined && array(answer.errors).length) {
    throw new ApiError("upstream_query_failed", 502, "A subgraph could not answer the query.")
  }
  const data = object(answer.data), meta = object(data._meta), block = object(meta.block)
  if (boolean(meta.hasIndexingErrors)) throw new ApiError("indexing_error", 503, "A subgraph reports indexing errors.")
  if (block.timestamp === null) throw new ApiError("unknown_freshness", 503, "A subgraph does not report its block time.")
  const timestamp = integer(block.timestamp), hash = string(block.hash)
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw malformed()
  const age = Math.floor(now / 1000) - timestamp
  if (age < -60 || age > SUBGRAPH_STALE_AFTER_SECONDS) throw new ApiError("stale_upstream", 503, "A subgraph is not current.")
  if (pinnedHash && hash.toLowerCase() !== pinnedHash.toLowerCase()) throw new ApiError("snapshot_changed", 503, "The indexed snapshot changed. Start again.")
  return {
    data,
    freshness: { source, checkedAt: new Date(now).toISOString(), block: integer(block.number), blockHash: hash, blockTimestamp: timestamp, ageSeconds: Math.max(0, age) },
    expiresAt: (timestamp + SUBGRAPH_STALE_AFTER_SECONDS) * 1000,
  }
}
