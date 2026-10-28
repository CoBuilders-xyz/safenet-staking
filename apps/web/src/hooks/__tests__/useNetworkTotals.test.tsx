import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { MOCK_VALIDATORS } from "@/__tests__/test-data"
import { STALE_AGE, answerOperations, meta, mockRequest, queryWrapper, read } from "@/__tests__/subgraph-mocks"
import { networkMessages, useNetworkTotals } from "../useNetworkTotals"
import { i18n } from "@/i18n"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const { mockTotalStaked, mockValidators } = vi.hoisted(() => ({ mockTotalStaked: vi.fn(), mockValidators: vi.fn() }))
vi.mock("@/hooks/useStakingReads", () => ({ useTotalStaked: (o: unknown) => mockTotalStaked(o) }))
vi.mock("@/hooks/useValidators", () => ({ useValidators: () => mockValidators() }))

const SAFE = 10n ** 18n
const NETWORK = { totalStaked: (900n * SAFE).toString(), stakersCurrent: 884, rewardsClaimed: "0", currentRoot: null }

function render() {
  return renderHook(() => useNetworkTotals(), { wrapper: queryWrapper() })
}

describe("useNetworkTotals", () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockTotalStaked.mockReturnValue(read(1000n * SAFE))
    mockValidators.mockReturnValue({ data: MOCK_VALIDATORS, error: null })
  })

  it("reads every figure from the subgraph while it is live, and holds the contract read", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("ready"))

    expect(result.current.totalStaked).toEqual({ state: "ready", value: 900n * SAFE, source: "subgraph" })
    expect(result.current.validatorCounts).toEqual({ state: "ready", value: { active: 2, withdrawn: 0 }, source: "sef" })
    expect(result.current.stakers).toEqual({ state: "ready", value: 884, source: "subgraph" })
    expect(mockTotalStaked).toHaveBeenLastCalledWith({ enabled: false })
  })

  it("falls back to the contract and SEF's list when the subgraph fails; stakers is unavailable", async () => {
    answerOperations({ NetworkTotals: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("ready"))

    expect(mockTotalStaked).toHaveBeenLastCalledWith({ enabled: true })
    expect(result.current.totalStaked).toEqual({ state: "ready", value: 1000n * SAFE, source: "contract" })
    expect(result.current.validatorCounts).toEqual({ state: "ready", value: { active: 2, withdrawn: 0 }, source: "sef" })
    expect(result.current.stakers).toEqual({
      state: "unavailable",
      reason: "The subgraph could not be queried. No contract read gives this figure.",
    })
  })

  it("counts validators by SEF's flag, not the subgraph's registered count", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(), network: NETWORK } })
    mockValidators.mockReturnValue({ data: [MOCK_VALIDATORS[0], { ...MOCK_VALIDATORS[1], isActive: false }], error: null })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("ready"))
    expect(result.current.validatorCounts).toEqual({ state: "ready", value: { active: 1, withdrawn: 1 }, source: "sef" })
  })

  it("falls back when the subgraph is stale", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(STALE_AGE), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("ready"))
    expect(result.current.totalStaked.state === "ready" && result.current.totalStaked.source).toBe("contract")
  })

  it("falls back when the subgraph has not indexed the network row yet", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(), network: null } })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("ready"))
    expect(result.current.totalStaked.state === "ready" && result.current.totalStaked.source).toBe("contract")
  })

  it("says so when the fallback fails too", async () => {
    answerOperations({ NetworkTotals: new Error("down") })
    mockTotalStaked.mockReturnValue(read(undefined, new Error("rpc down")))
    mockValidators.mockReturnValue({ data: undefined, error: new Error("404") })
    const { result } = render()
    await waitFor(() => expect(result.current.totalStaked.state).toBe("unavailable"))
    expect(result.current.totalStaked).toEqual({ state: "unavailable", reason: networkMessages(i18n.t).stakingReadFailed })
    expect(result.current.validatorCounts).toEqual({ state: "unavailable", reason: networkMessages(i18n.t).validatorListFailed })
  })
})
