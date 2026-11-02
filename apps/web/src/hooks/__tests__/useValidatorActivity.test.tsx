import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { useValidatorActivity } from "../useValidatorActivity"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const V = TEST_ACCOUNTS.validator1
const HEAD = 26_287_212
const T0 = 1_774_569_600

const stake = (i: number, staker = `0x${(i % 7).toString(16).padStart(40, "0")}`) => ({
  id: `0x${i.toString(16).padStart(64, "0")}-${i}`,
  staker,
  amount: "1000",
  blockNumber: String(24_800_000 + i),
  timestamp: String(T0 + i * 600),
  transactionHash: `0x${i.toString(16).padStart(64, "0")}`,
})

const validator = (current: number, ever: number) => ({
  id: V.toLowerCase(),
  isRegistered: true,
  totalStaked: "0",
  stakersCurrent: current,
  stakersEver: ever,
  firstSeenAtBlock: "24741800",
  firstSeenAtTimestamp: "1774528907",
  registeredAtBlock: "24741826",
  registeredAtTimestamp: "1774529219",
})

const render = (address: string = V) => renderHook(() => useValidatorActivity(address), { wrapper: queryWrapper() })

describe("useValidatorActivity", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("reads one page, replays the delegators and checks them against the subgraph's count", async () => {
    answerOperations({
      ValidatorActivity: { _meta: meta(30, HEAD), validator: validator(2, 2), stakes: [stake(1, "0xaa"), stake(2, "0xbb")], withdrawals: [] },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    if (result.current.activity.state !== "ready") throw new Error("not ready")

    const a = result.current.activity.value
    expect(a.replayMatches).toBe(true)
    expect(a.block).toBe(HEAD)
    expect(a.delegators.current).toBe(2)
    expect(a.history.map((e) => e.kind)).toEqual(["stake", "stake", "registered"])
    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(mockRequest.mock.calls[0][0].variables).toEqual({ id: V.toLowerCase(), validator: V.toLowerCase(), stakesAfter: "", withdrawalsAfter: "" })
  })

  it("reads the next pages at the block of the first, after the last id of the list still filling", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => stake(i + 1))
    const second = [stake(1001), stake(1002)]
    mockRequest.mockImplementation(async ({ variables }: { variables: { stakesAfter: string; block?: { number: number } } }) =>
      variables.stakesAfter === ""
        ? { _meta: meta(30, HEAD), validator: validator(7, 7), stakes: first, withdrawals: [] }
        : { _meta: meta(30, HEAD), validator: validator(7, 7), stakes: second, withdrawals: [] },
    )
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    if (result.current.activity.state !== "ready") throw new Error("not ready")

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[1][0].variables).toMatchObject({ block: { number: HEAD }, stakesAfter: first[999].id, withdrawalsAfter: "" })
    expect(result.current.activity.value.history.filter((e) => e.kind === "stake")).toHaveLength(1002)
    expect(result.current.activity.value.replayMatches).toBe(true)
  })

  it("flags a replay that differs from the subgraph's own count", async () => {
    answerOperations({ ValidatorActivity: { _meta: meta(30, HEAD), validator: validator(3, 3), stakes: [stake(1, "0xaa")], withdrawals: [] } })
    const { result } = render()
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    if (result.current.activity.state !== "ready") throw new Error("not ready")
    expect(result.current.activity.value.replayMatches).toBe(false)
  })

  it("is ready with no validator for an address the subgraph does not know", async () => {
    answerOperations({ ValidatorActivity: { _meta: meta(30, HEAD), validator: null, stakes: [], withdrawals: [] } })
    const { result } = render(TEST_ACCOUNTS.user)
    await waitFor(() => expect(result.current.activity.state).toBe("ready"))
    if (result.current.activity.state !== "ready") throw new Error("not ready")
    expect(result.current.activity.value.validator).toBeNull()
    expect(result.current.activity.value.history).toEqual([])
  })

  it("is unavailable, with the reason, when a page fails", async () => {
    answerOperations({ ValidatorActivity: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.activity).toEqual({ state: "unavailable", reason: "The subgraph could not be queried." }))
  })
})
