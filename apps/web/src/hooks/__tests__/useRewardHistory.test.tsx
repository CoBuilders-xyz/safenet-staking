import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { meta, queryWrapper, STALE_AGE } from "@/__tests__/subgraph-mocks"
import { readFreshness } from "@/lib/subgraph"
import { RewardHistoryError, type RewardHistory } from "@/lib/rewardHistory"
import { useRewardHistory } from "../useRewardHistory"

const mock = vi.hoisted(() => ({
  account: vi.fn(), read: vi.fn(), contract: vi.fn(),
}))
vi.mock("wagmi", () => ({
  useAccount: () => mock.account(),
  usePublicClient: () => ({ readContract: mock.contract }),
}))
vi.mock("@/lib/rewardHistory", async (original) => ({
  ...await original<typeof import("@/lib/rewardHistory")>(),
  readRewardHistory: (...args: unknown[]) => mock.read(...args),
}))
const answer = (age = 30): RewardHistory => ({ rows: [], totalPeriods: 0, freshness: readFreshness(meta(age), Date.now()) })
const render = () => renderHook(() => useRewardHistory(), { wrapper: queryWrapper() })
beforeEach(() => {
  vi.clearAllMocks()
  mock.account.mockReturnValue({ address: TEST_ACCOUNTS.user })
  mock.read.mockResolvedValue(answer())
})
afterEach(() => { vi.useRealTimers() })

describe("useRewardHistory", () => {
  it("does not query a disconnected account", () => {
    mock.account.mockReturnValue({})
    const { result } = render()
    expect(result.current.state.status).toBe("disconnected")
    expect(mock.read).not.toHaveBeenCalled()
  })
  it("does not show another account's cached history after switching accounts", async () => {
    const { result, rerender } = render()
    await waitFor(() => expect(result.current.state.status).toBe("ready"))
    mock.account.mockReturnValue({ address: TEST_ACCOUNTS.validator1 })
    mock.read.mockReturnValue(new Promise(() => {}))
    rerender()
    expect(result.current.state.status).toBe("loading")
    expect(result.current.address).toBe(TEST_ACCOUNTS.validator1)
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2))
  })
  it("hides history immediately when the wallet disconnects", async () => {
    const { result, rerender } = render()
    await waitFor(() => expect(result.current.state.status).toBe("ready"))
    mock.account.mockReturnValue({})
    rerender()
    expect(result.current.state.status).toBe("disconnected")
  })
  it.each(["incomplete", "unavailable", "stale"] as const)("keeps %s explicit", async (reason) => {
    mock.read.mockRejectedValue(new RewardHistoryError(reason))
    const { result } = render()
    await waitFor(() => expect(result.current.state).toEqual({ status: reason }))
  })
  it("does not expose raw provider errors or retain successful figures after a failed refresh", async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.state.status).toBe("ready"))
    mock.read.mockRejectedValue(new Error("private endpoint details"))
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.state).toEqual({ status: "unavailable" }))
  })
  it("rejects stale cached data", async () => {
    mock.read.mockResolvedValue(answer(STALE_AGE))
    const { result } = render()
    await waitFor(() => expect(result.current.state).toEqual({ status: "stale" }))
  })
  it("ends a hanging archive load after 30 seconds and never displays its late answer", async () => {
    vi.useFakeTimers()
    let resolve!: (data: RewardHistory) => void
    mock.read.mockReturnValue(new Promise<RewardHistory>((r) => { resolve = r }))
    const { result } = render()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_010) })
    expect(result.current.state).toEqual({ status: "unavailable" })
    await act(async () => { resolve(answer()); await vi.advanceTimersByTimeAsync(10) })
    expect(result.current.state).toEqual({ status: "unavailable" })
  })
})
