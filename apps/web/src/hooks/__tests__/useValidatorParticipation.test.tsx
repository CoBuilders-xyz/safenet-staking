import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { useValidatorParticipation } from "../useValidatorParticipation"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const V = TEST_ACCOUNTS.validator1
const v = V.toLowerCase()
const DAY = 86_400
const end = utcDayMs(BETA_END_DAY) / 1000
const days = [end - 2 * DAY, end - DAY, end]

const render = () => renderHook(() => useValidatorParticipation(V), { wrapper: queryWrapper() })

describe("useValidatorParticipation", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("asks for the validator by lowercase address and builds its series", async () => {
    answerOperations({
      ValidatorParticipation: {
        _meta: meta(), memberships: [{ programme: "beta", validatorCount: 1, validators: [{ id: v }] }],
        consensusDays: days.map((d) => ({ id: String(d), date: d, attestationCeremonies: "1000" })),
        validatorDays: days.map((d) => ({ id: `${v}-${d}`, date: d, attended: "980" })),
        consensusHours: [],
        validatorHours: [],
      },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.series.state).toBe("ready"))
    if (result.current.series.state !== "ready") throw new Error("not ready")

    expect(mockRequest.mock.calls[0][0].variables).toMatchObject({ validator: v })
    expect(result.current.series.value.daily.map((p) => [p.start, p.rate])).toEqual([
      [end - DAY, 0.98],
      [end, 0.98],
    ])
    expect(result.current.series.value.hourly).toEqual([])
  })

  it("is ready with empty series when the subgraph holds nothing for the validator", async () => {
    answerOperations({ ValidatorParticipation: { _meta: meta(), memberships: [{ programme: "beta", validatorCount: 1, validators: [{ id: v }] }], consensusDays: [], validatorDays: [], consensusHours: [], validatorHours: [] } })
    const { result } = render()
    await waitFor(() => expect(result.current.series).toEqual({ state: "ready", source: "subgraph", value: { hourly: [], daily: [] } }))
  })

  it("is unavailable, with the reason, when the subgraph fails", async () => {
    answerOperations({ ValidatorParticipation: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.series).toEqual({ state: "unavailable", reason: "The subgraph could not provide complete, consistent history." }))
  })
})

describe("participation pagination and provenance", () => {
  const empty = () => ({ _meta: { ...meta(), block: { ...meta().block, timestamp: meta().block.timestamp as number | null } }, memberships: [{ programme: "beta", validatorCount: 1, validators: [{ id: v }] }], consensusDays: [], validatorDays: [], consensusHours: [], validatorHours: [] })
  it("pages independent lists by id at one block, including a final empty page", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `beta-${i.toString().padStart(5, "0")}`, programme: "beta", hour: end - i * 3600, attestationCeremonies: 40 }))
    mockRequest.mockReset()
    mockRequest.mockImplementation(async ({ variables }: { variables: { hoursAfter: string } }) => ({ ...empty(), consensusHours: variables.hoursAfter === "" ? rows : [] }))
    const { result } = render()
    await waitFor(() => expect(result.current.series.state).toBe("ready"))
    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[1][0].variables).toMatchObject({ block: { number: meta().block.number }, hoursAfter: rows.at(-1)!.id })
    if (result.current.series.state !== "ready") throw new Error("not ready")
    expect(result.current.series.value.hourly).toHaveLength(999)
    expect(result.current.series.value.hourly.every((p) => p.rate === 0)).toBe(true)
  })
  it.each(["stale", "missing timestamp", "indexing error", "missing membership"])("hides %s answers", async (kind) => {
    mockRequest.mockReset()
    const response = { ...empty(), consensusDays: [{ id: String(end), date: end, attestationCeremonies: "10" }] }
    if (kind === "stale") response._meta = meta(3600)
    if (kind === "missing timestamp") response._meta.block.timestamp = null
    if (kind === "indexing error") response._meta.hasIndexingErrors = true
    if (kind === "missing membership") response.memberships = []
    answerOperations({ ValidatorParticipation: response })
    const { result } = render()
    await waitFor(() => expect(result.current.series.state).toBe("unavailable"))
  })
  it("rejects later pages served at another block", async () => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValueOnce({ ...empty(), consensusHours: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), hour: end, attestationCeremonies: 1 })) })
      .mockResolvedValueOnce({ ...empty(), _meta: meta(10, 999) })
    const { result } = render()
    await waitFor(() => expect(result.current.series.state).toBe("unavailable"))
  })
})
