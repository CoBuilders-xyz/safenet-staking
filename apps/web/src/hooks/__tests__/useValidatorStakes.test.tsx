import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { MOCK_VALIDATORS, TEST_ACCOUNTS } from "@/__tests__/test-data"
import { answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { useValidatorStakes } from "../useValidatorStakes"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const { mockStakes, mockValidators } = vi.hoisted(() => ({ mockStakes: vi.fn(), mockValidators: vi.fn() }))
vi.mock("@/hooks/useStakingReads", () => ({
  useValidatorTotalStakes: (v: unknown, o: unknown) => mockStakes(v, o),
}))
vi.mock("@/hooks/useValidators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useValidators")>()),
  useValidators: () => mockValidators(),
}))

const SAFE = 10n ** 18n
const ok = (result: bigint) => ({ status: "success", result })

function render() {
  return renderHook(() => useValidatorStakes(), { wrapper: queryWrapper() })
}

describe("useValidatorStakes", () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockValidators.mockReturnValue({ data: MOCK_VALIDATORS, error: null })
    mockStakes.mockReturnValue({ data: [ok(100n * SAFE), ok(300n * SAFE)], error: null })
  })

  it("reads stakes from the subgraph, labels them from SEF, largest first", async () => {
    answerOperations({
      ValidatorStakes: {
        _meta: meta(),
        validators: [
          { id: TEST_ACCOUNTS.validator1, totalStaked: (750n * SAFE).toString(), stakersCurrent: 10 },
          { id: TEST_ACCOUNTS.validator2, totalStaked: (250n * SAFE).toString(), stakersCurrent: 3 },
        ],
      },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.rows.state).toBe("ready"))
    if (result.current.rows.state !== "ready") throw new Error("not ready")

    expect(result.current.rows.source).toBe("subgraph")
    expect(result.current.rows.value.map((r) => [r.label, r.share, r.stakers])).toEqual([
      ["Gnosis", 0.75, 10],
      ["Greenfield", 0.25, 3],
    ])
    expect(mockStakes).toHaveBeenLastCalledWith(expect.any(Array), { enabled: false })
  })

  it("falls back to one contract read per SEF validator when the subgraph fails", async () => {
    answerOperations({ ValidatorStakes: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.rows.state).toBe("ready"))
    if (result.current.rows.state !== "ready") throw new Error("not ready")

    expect(mockStakes).toHaveBeenLastCalledWith([TEST_ACCOUNTS.validator1, TEST_ACCOUNTS.validator2], { enabled: true })
    expect(result.current.rows.source).toBe("contract")
    expect(result.current.rows.value.map((r) => [r.label, r.share, r.stakers])).toEqual([
      ["Greenfield", 0.75, undefined],
      ["Gnosis", 0.25, undefined],
    ])
  })

  it("keeps a withdrawn validator in the fallback: its stake is still staked", async () => {
    answerOperations({ ValidatorStakes: new Error("down") })
    mockValidators.mockReturnValue({ data: [MOCK_VALIDATORS[0], { ...MOCK_VALIDATORS[1], isActive: false }], error: null })
    const { result } = render()
    await waitFor(() => expect(result.current.rows.state).toBe("ready"))
    if (result.current.rows.state !== "ready") throw new Error("not ready")

    expect(mockStakes).toHaveBeenLastCalledWith([TEST_ACCOUNTS.validator1, TEST_ACCOUNTS.validator2], { enabled: true })
    expect(result.current.rows.value.map((r) => r.label)).toEqual(["Greenfield", "Gnosis"])
  })

  it("makes the distribution unavailable when one fallback read fails, rather than wrong", async () => {
    answerOperations({ ValidatorStakes: new Error("down") })
    mockStakes.mockReturnValue({ data: [ok(100n * SAFE), { status: "failure", error: new Error("x") }], error: null })
    const { result } = render()
    await waitFor(() => expect(result.current.rows.state).toBe("unavailable"))
    expect(result.current.rows).toEqual({
      state: "unavailable",
      reason: "1 of 2 validator stakes could not be read, so shares would be wrong.",
    })
  })

  it("is unavailable when neither the subgraph nor SEF's list answers", async () => {
    answerOperations({ ValidatorStakes: new Error("down") })
    mockValidators.mockReturnValue({ data: undefined, error: new Error("404") })
    const { result } = render()
    await waitFor(() => expect(result.current.rows.state).toBe("unavailable"))
  })
})
