import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { GNOSIS_SNAPSHOT } from "@cobuilders/safenet-core"
import { STALE_AGE, answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { CONSENSUS_MESSAGES, useConsensusFigures } from "../useConsensusFigures"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const DAY = 86_400
const V = "0x00000000000000000000000000000000000000aa"

function window() {
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY
  const day = (offset: number, attestations: number) => ({
    date: today + offset * DAY,
    attestations: String(attestations),
    attestationCeremonies: "100",
    latencyBuckets: ["0", "0", "0", "4"],
  })
  return {
    _meta: meta(10, 48_600_000),
    firstDay: [{ date: today - 3 * DAY }],
    consensusDays: [day(-3, 1), day(-2, 4000), day(-1, 5000), day(0, 9)],
    validatorDays: [
      { date: today - 2 * DAY, attended: "100", validator: { id: V } },
      { date: today - 1 * DAY, attended: "90", validator: { id: V } },
    ],
  }
}

function render() {
  return renderHook(() => useConsensusFigures(), { wrapper: queryWrapper() })
}

describe("useConsensusFigures", () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it("replaces the snapshot with the subgraph's complete days while it is live", async () => {
    answerOperations({ ConsensusWindow: window() })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))

    expect(result.current.attestations).toEqual({ state: "ready", value: { mean: 4500, min: 4000, max: 5000, days: 2 }, source: "subgraph" })
    expect(result.current.latency).toEqual({ state: "ready", value: { medianBlocks: 3, seconds: 15 }, source: "subgraph" })
    expect(result.current.participation?.get(V)?.rate).toBe(0.95)
    expect(result.current.snapshotReason).toBeUndefined()
  })

  it("shows the snapshot, and says why, when the subgraph has no complete day yet", async () => {
    const w = window()
    answerOperations({ ConsensusWindow: { ...w, firstDay: [{ date: w.consensusDays[2].date }] } })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))

    expect(result.current.attestations.state === "ready" && result.current.attestations.source).toBe("snapshot")
    expect(result.current.attestations.state === "ready" && result.current.attestations.value.mean).toBe(GNOSIS_SNAPSHOT.attestationsPerDay)
    expect(result.current.snapshotReason).toBe(CONSENSUS_MESSAGES.noCompleteDay)
    expect(result.current.participation).toBeUndefined()
  })

  it("falls back to the snapshot latency, with a reason, when no attestation could be matched", async () => {
    const w = window()
    answerOperations({ ConsensusWindow: { ...w, consensusDays: w.consensusDays.map((d) => ({ ...d, latencyBuckets: ["0"] })) } })
    const { result } = render()
    await waitFor(() => expect(result.current.latency.state).toBe("ready"))
    expect(result.current.attestations.state === "ready" && result.current.attestations.source).toBe("subgraph")
    expect(result.current.latency.state === "ready" && result.current.latency.source).toBe("snapshot")
    expect(result.current.snapshotReason).toBe(CONSENSUS_MESSAGES.noLatencySample)
  })

  it("shows the snapshot when the subgraph is stale", async () => {
    answerOperations({ ConsensusWindow: { ...window(), _meta: meta(STALE_AGE) } })
    const { result } = render()
    await waitFor(() => expect(result.current.latency.state).toBe("ready"))
    expect(result.current.latency).toEqual({
      state: "ready",
      value: { medianBlocks: GNOSIS_SNAPSHOT.latencyMedianBlocks, seconds: GNOSIS_SNAPSHOT.latencySeconds },
      source: "snapshot",
    })
    expect(result.current.snapshotReason).toMatch(/past the 15 min limit/)
  })

  it("shows the snapshot when the subgraph fails", async () => {
    answerOperations({ ConsensusWindow: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))
    expect(result.current.attestations.state === "ready" && result.current.attestations.source).toBe("snapshot")
    expect(result.current.snapshotReason).toBe("The subgraph could not be queried.")
  })
})
