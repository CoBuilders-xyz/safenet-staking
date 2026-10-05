import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { STALE_AGE, answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { RECENT_DAYS, useRecentDays } from "../useRecentDays"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const SAFE = 10n ** 18n
const DAY = 86_400

function dayData(date: number, stakedIn: bigint, withdrawnOut: bigint, stakeCount: number) {
  return {
    date,
    totalStaked: "0",
    stakedIn: stakedIn.toString(),
    withdrawnOut: withdrawnOut.toString(),
    rewardsClaimed: (1n * SAFE).toString(),
    stakeCount,
    withdrawalCount: withdrawnOut > 0n ? 1 : 0,
  }
}

function render() {
  return renderHook(() => useRecentDays(), { wrapper: queryWrapper() })
}

describe("useRecentDays", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("sums the daily buckets of the window, asking from the first day of it", async () => {
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY
    answerOperations({
      RecentDays: {
        _meta: meta(),
        dayDatas: [dayData(today - 2 * DAY, 100n * SAFE, 0n, 3), dayData(today, 50n * SAFE, 20n * SAFE, 1)],
      },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    if (result.current.activity.state !== "ready") throw new Error("not ready")

    const a = result.current.activity.value
    expect(a.since).toBe(today - (RECENT_DAYS - 1) * DAY)
    expect([a.stakedIn, a.withdrawnOut, a.rewardsClaimed, a.stakes, a.withdrawals]).toEqual([150n * SAFE, 20n * SAFE, 2n * SAFE, 4, 1])
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ variables: { since: today - (RECENT_DAYS - 1) * DAY } }))
  })

  it("is ready with zeros over a quiet window, which has no rows", async () => {
    answerOperations({ RecentDays: { _meta: meta(), dayDatas: [] } })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    expect(result.current.activity.state === "ready" && result.current.activity.value.stakes).toBe(0)
  })

  it("is unavailable with the reason when the subgraph is stale: no contract gives a history", async () => {
    answerOperations({ RecentDays: { _meta: meta(STALE_AGE, 42), dayDatas: [] } })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("unavailable"))
    expect(result.current.activity.state === "unavailable" && result.current.activity.reason).toMatch(
      /^The subgraph's last indexed block, 42, is .* No contract read gives a daily history\.$/,
    )
  })

  it("is unavailable when the subgraph fails", async () => {
    answerOperations({ RecentDays: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("unavailable"))
  })
})
