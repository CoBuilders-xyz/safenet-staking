import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { NetworkTotalsDocument } from "@/graphql/mainnet/generated"
import { STALE_AGE, answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { selectLive, useSubgraphQuery } from "../useSubgraphQuery"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const { urls } = vi.hoisted(() => ({
  urls: { mainnet: "https://mainnet.subgraph.test" as string | undefined, gnosis: "https://gnosis.subgraph.test" as string | undefined },
}))
vi.mock("@/config/subgraphs", () => ({ SUBGRAPH_URLS: urls }))

const NETWORK = { totalStaked: "1", activeValidators: 1, stakersCurrent: 1, rewardsClaimed: "0", currentRoot: null }

function render() {
  return renderHook(() => useSubgraphQuery("mainnet", "network", NetworkTotalsDocument), { wrapper: queryWrapper() })
}

describe("useSubgraphQuery", () => {
  beforeEach(() => {
    mockRequest.mockReset()
    urls.mainnet = "https://mainnet.subgraph.test"
  })

  it("is live when the answer passes the freshness rule, and carries the freshness", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(20, 123), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("live"))
    if (result.current.status !== "live") throw new Error("not live")
    expect(result.current.freshness.block).toBe(123)
    expect(result.current.freshness.ageSeconds).toBeGreaterThanOrEqual(20)
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ url: "https://mainnet.subgraph.test" }))
  })

  it("degrades as stale past the threshold, keeping the freshness to show", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(STALE_AGE, 9), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("degraded"))
    if (result.current.status !== "degraded") throw new Error("not degraded")
    expect(result.current.degradation.kind).toBe("stale")
    expect(result.current.freshness?.block).toBe(9)
  })

  it("degrades on an indexing error", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(5, 9, true), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("degraded"))
    expect(result.current.status === "degraded" && result.current.degradation.kind).toBe("indexing-error")
  })

  it("degrades as failed when the request fails", async () => {
    answerOperations({ NetworkTotals: new Error("connection refused") })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("degraded"), { timeout: 4000 })
    expect(result.current.status === "degraded" && result.current.degradation).toEqual({ kind: "failed", message: "connection refused" })
  })

  it("degrades as unconfigured, without a request, when the build has no endpoint", () => {
    urls.mainnet = undefined
    const { result } = render()
    expect(result.current).toEqual({ status: "degraded", degradation: { kind: "unconfigured" } })
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe("selectLive", () => {
  const freshness = { block: 1, blockTimestamp: 1, ageSeconds: 1, checkedAt: 1, hasIndexingErrors: false }

  it("narrows a live answer to the part a hook needs", () => {
    expect(selectLive({ status: "live", data: { network: NETWORK }, freshness }, (d) => d.network)).toEqual({
      status: "live",
      value: NETWORK,
      freshness,
    })
  })

  it("degrades as empty when the live answer lacks that part", () => {
    expect(selectLive({ status: "live", data: { network: null }, freshness }, (d) => d.network)).toEqual({
      status: "degraded",
      degradation: { kind: "empty", freshness },
    })
  })
})
