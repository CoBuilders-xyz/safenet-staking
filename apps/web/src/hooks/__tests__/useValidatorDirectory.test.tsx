import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { answerOperations, meta, mockRequest, queryWrapper, STALE_AGE } from "@/__tests__/subgraph-mocks"
import { useValidatorDirectory } from "../useValidatorDirectory"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const render = () => renderHook(() => useValidatorDirectory(), { wrapper: queryWrapper() })

const validators = [
  {
    id: TEST_ACCOUNTS.validator1,
    isRegistered: true,
    totalStaked: "1",
    stakersCurrent: 446,
    stakersEver: 463,
    firstSeenAtBlock: "24741800",
    firstSeenAtTimestamp: "1774528907",
    registeredAtBlock: "24741826",
    registeredAtTimestamp: "1774529219",
  },
  // Not registered, and no registration indexed: a stake named it first.
  { id: TEST_ACCOUNTS.validator2, isRegistered: false, totalStaked: "0", stakersCurrent: 0, stakersEver: 0, registeredAtBlock: null, registeredAtTimestamp: null, firstSeenAtBlock: "24741800", firstSeenAtTimestamp: "1774528907" },
]

describe("useValidatorDirectory", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("keys each validator's delegators and registration by lowercase address", async () => {
    answerOperations({ ValidatorDirectory: { _meta: meta(), validators } })
    const { result } = render()
    await waitFor(() => expect(result.current.entries.state).toBe("ready"))
    if (result.current.entries.state !== "ready") throw new Error("not ready")

    expect(result.current.entries.value.get(TEST_ACCOUNTS.validator1.toLowerCase())).toEqual({
      isRegistered: true,
      delegators: 446,
      delegatorsEver: 463,
      firstSeenAt: { block: 24_741_800n, timestamp: 1_774_528_907 },
      registeredAt: { block: 24_741_826n, timestamp: 1_774_529_219 },
    })
    expect(result.current.entries.value.get(TEST_ACCOUNTS.validator2.toLowerCase())?.registeredAt).toBeUndefined()
    expect(result.current.entries.value.get(TEST_ACCOUNTS.validator2.toLowerCase())?.firstSeenAt).toEqual({ block: 24_741_800n, timestamp: 1_774_528_907 })
  })

  it("is unavailable, with the reason, when the subgraph fails or is stale", async () => {
    answerOperations({ ValidatorDirectory: new Error("down") })
    const failed = render()
    await waitFor(() => expect(failed.result.current.entries).toEqual({ state: "unavailable", reason: "The subgraph could not be queried." }))

    answerOperations({ ValidatorDirectory: { _meta: meta(STALE_AGE), validators } })
    const stale = render()
    await waitFor(() => expect(stale.result.current.entries.state).toBe("unavailable"))
  })

  it("is unavailable when the subgraph has indexed no validator yet", async () => {
    answerOperations({ ValidatorDirectory: { _meta: meta(), validators: [] } })
    const { result } = render()
    await waitFor(() => expect(result.current.entries).toEqual({ state: "unavailable", reason: "The subgraph has not indexed this data yet." }))
  })
})

it("does not silently accept a potentially truncated directory", async () => {
  answerOperations({ ValidatorDirectory: { _meta: meta(), validators: Array.from({ length: 1000 }, () => validators[0]) } })
  const { result } = render()
  await waitFor(() => expect(result.current.entries.state).toBe("unavailable"))
})
