import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SUBGRAPH_STALE_AFTER_SECONDS } from "@cobuilders/safenet-core"
import { NetworkTotalsDocument } from "@/graphql/mainnet/generated"
import { mockRequest } from "@/__tests__/subgraph-mocks"
import {
  assessFreshness,
  describeDegradation,
  SUBGRAPH_TIMEOUT_MS,
  fetchSubgraph,
  formatAge,
  readFreshness,
  type Freshness,
} from "../subgraph"
import { i18n } from "@/i18n"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const CHECKED_AT = 1_791_000_000_000

function freshness(ageSeconds: number | null, hasIndexingErrors = false): Freshness {
  return { block: 100, blockTimestamp: 0, ageSeconds, checkedAt: CHECKED_AT, hasIndexingErrors }
}

describe("readFreshness", () => {
  it("measures the age of the last indexed block at the moment of the query", () => {
    const f = readFreshness({ block: { number: 7, timestamp: CHECKED_AT / 1000 - 42 }, hasIndexingErrors: false }, CHECKED_AT)
    expect(f).toEqual({ block: 7, blockTimestamp: CHECKED_AT / 1000 - 42, ageSeconds: 42, checkedAt: CHECKED_AT, hasIndexingErrors: false })
  })

  it("leaves the age unknown when the node reports no timestamp", () => {
    expect(readFreshness({ block: { number: 7, timestamp: null }, hasIndexingErrors: false }, CHECKED_AT).ageSeconds).toBeNull()
  })
})

describe("assessFreshness", () => {
  it("accepts an answer exactly at the threshold", () => {
    expect(assessFreshness(freshness(SUBGRAPH_STALE_AFTER_SECONDS))).toBeUndefined()
  })

  it("rejects an answer one second past it", () => {
    expect(assessFreshness(freshness(SUBGRAPH_STALE_AFTER_SECONDS + 1))?.kind).toBe("stale")
  })

  it("rejects an unknown age, because nothing proves it current", () => {
    expect(assessFreshness(freshness(null))?.kind).toBe("stale")
  })

  it("rejects a subgraph with an indexing error, however recent", () => {
    expect(assessFreshness(freshness(5, true))?.kind).toBe("indexing-error")
  })
})

describe("formatAge", () => {
  it.each([
    [42, "42 s"],
    [900, "15 min"],
    [901, "15 min 1 s"],
    [959, "15 min 59 s"],
    [3600, "1 h"],
    [3 * 3600, "3 h"],
    [5 * 86_400, "5 d"],
  ])("%i seconds reads %s", (s, text) => {
    expect(formatAge(s, i18n.t)).toBe(text)
  })
})

describe("describeDegradation", () => {
  it("gives the block and the age for a stale subgraph", () => {
    expect(describeDegradation({ kind: "stale", freshness: { ...freshness(7200), block: 25_700_259 } }, i18n.t)).toBe(
      "The subgraph's last indexed block, 25,700,259, is 2 h old, past the 15 min limit.",
    )
  })

  it("never says an age just past the limit equals the limit", () => {
    expect(describeDegradation({ kind: "stale", freshness: { ...freshness(901), block: 1 } }, i18n.t)).toBe(
      "The subgraph's last indexed block, 1, is 15 min 1 s old, past the 15 min limit.",
    )
  })

  it("says when no endpoint is configured", () => {
    expect(describeDegradation({ kind: "unconfigured" }, i18n.t)).toBe("No subgraph endpoint is configured for this build.")
  })
})

describe("fetchSubgraph", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("returns the data with freshness read from the same response", async () => {
    const ts = Math.floor(Date.now() / 1000) - 12
    mockRequest.mockResolvedValue({ _meta: { block: { number: 9, timestamp: ts }, hasIndexingErrors: false }, network: null })

    const answer = await fetchSubgraph("https://subgraph.test", NetworkTotalsDocument, undefined)

    expect(answer.freshness.block).toBe(9)
    expect(answer.freshness.ageSeconds).toBeGreaterThanOrEqual(12)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://subgraph.test", document: NetworkTotalsDocument, signal: expect.any(AbortSignal) }),
    )
  })

  describe("with a node that never answers", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("gives up after SUBGRAPH_TIMEOUT_MS, so the page can fall back", async () => {
      mockRequest.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      )
      const pending = fetchSubgraph("https://subgraph.test", NetworkTotalsDocument, undefined)
      const outcome = expect(pending).rejects.toThrow(`no answer within ${SUBGRAPH_TIMEOUT_MS} ms`)
      await vi.advanceTimersByTimeAsync(SUBGRAPH_TIMEOUT_MS - 1)
      await vi.advanceTimersByTimeAsync(1)
      await outcome
    })
  })

  it("refuses an answer without _meta, because nothing then says how current it is", async () => {
    mockRequest.mockResolvedValue({ _meta: null, network: null })
    await expect(fetchSubgraph("https://subgraph.test", NetworkTotalsDocument, undefined)).rejects.toThrow("_meta")
  })
})

describe("Network gateway fallback", () => {
  const gateway = "https://gateway.thegraph.com/api/test-only-key/subgraphs/id/K1gHS5P5vZU3LApqchuuQxkmZGDDAUavkQUdGDV7Vxs"
  const studio = "https://api.studio.thegraph.com/query/1763864/safenet-mainnet/e66567d"
  const data = { _meta: { block: { number: 9, timestamp: 1_791_000_000 }, hasIndexingErrors: false }, network: null }
  beforeEach(() => { mockRequest.mockReset() })
  it("uses successful gateway data without a Studio request", async () => {
    mockRequest.mockResolvedValue(data)
    expect((await fetchSubgraph(gateway, NetworkTotalsDocument, undefined)).data).toEqual(data)
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })
  it.each(["401 auth", "402 billing", "429 rate", "503 upstream", "network", "GraphQL auth error at HTTP200"])("retries Studio after %s", async (failure) => {
    mockRequest.mockRejectedValueOnce(new Error(failure)).mockResolvedValueOnce(data)
    expect((await fetchSubgraph(gateway, NetworkTotalsDocument, undefined)).data).toEqual(data)
    expect(mockRequest.mock.calls.map(([o]) => (o as { url: string }).url)).toEqual([gateway, studio])
  })
  it("surfaces an error when both providers fail, without provider text or key", async () => {
    mockRequest.mockRejectedValue(new Error("test-only-key"))
    await expect(fetchSubgraph(gateway, NetworkTotalsDocument, undefined)).rejects.toThrow("gateway and Studio fallback both failed")
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })
})
