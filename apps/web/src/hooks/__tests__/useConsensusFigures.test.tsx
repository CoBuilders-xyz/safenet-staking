import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { AEGIS_START_DAY, BETA_END_DAY, GNOSIS_SNAPSHOT, utcDayMs } from "@cobuilders/safenet-core"
import { CONSENSUS_QUERY_DAYS } from "@/lib/consensus"
import { STALE_AGE, answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { consensusMessages, useConsensusFigures } from "../useConsensusFigures"
import { i18n } from "@/i18n"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

// The programme the Gnosis subgraph indexes, switchable per test. Beta, as in core, by default.
const indexed = vi.hoisted(() => ({ programme: "beta" as "beta" | "aegis" }))
vi.mock("@cobuilders/safenet-core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@cobuilders/safenet-core")>()
  return {
    ...core,
    get GNOSIS_INDEXED_PROGRAMME() {
      return indexed.programme
    },
  }
})

// Days counted from the core calendar, in unix seconds; no programme date is typed here.
const END = utcDayMs(BETA_END_DAY) / 1000
const START = utcDayMs(AEGIS_START_DAY) / 1000
/** The stray ceremony the Beta contract recorded after Beta ended: chain data, not a programme date. */
const STRAY = Date.parse("2026-10-06T00:00:00Z") / 1000
/** Noon UTC on a day. The tests pin the clock, so they do not depend on today's date. */
const noon = (date: number) => new Date((date + 43_200) * 1000)

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
    indexed.programme = "beta"
    // Only Date is faked, so the query client and waitFor keep their real timers. Inside Beta.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(noon(END - 86_400))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks for the newest days up to Beta's last day", async () => {
    answerOperations({ ConsensusWindow: window() })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { days: CONSENSUS_QUERY_DAYS, until: utcDayMs(BETA_END_DAY) / 1000 } }),
    )
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
    expect(result.current.snapshotReason).toBe(consensusMessages(i18n.t).noCompleteDay)
    expect(result.current.participation).toBeUndefined()
  })

  it("falls back to the snapshot latency, with a reason, when no attestation could be matched", async () => {
    const w = window()
    answerOperations({ ConsensusWindow: { ...w, consensusDays: w.consensusDays.map((d) => ({ ...d, latencyBuckets: ["0"] })) } })
    const { result } = render()
    await waitFor(() => expect(result.current.latency.state).toBe("ready"))
    expect(result.current.attestations.state === "ready" && result.current.attestations.source).toBe("subgraph")
    expect(result.current.latency.state === "ready" && result.current.latency.source).toBe("snapshot")
    expect(result.current.snapshotReason).toBe(consensusMessages(i18n.t).noLatencySample)
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

  it("dates the figures as Beta and leaves out the stray ceremony of 6 October", async () => {
    vi.setSystemTime(noon(END + 3 * DAY))
    // The Beta Consensus contract's last days, as Studio holds them: Beta's last day, then one stray.
    const d = (date: number, ceremonies: number) => ({
      date,
      attestations: String(ceremonies),
      attestationCeremonies: String(ceremonies),
      latencyBuckets: ["0", "1"],
    })
    answerOperations({
      ConsensusWindow: {
        ...window(),
        firstDay: [{ date: END - 2 * DAY }],
        consensusDays: [d(STRAY, 1), d(END, 1210), d(END - DAY, 3367), d(END - 2 * DAY, 3284)],
        validatorDays: [],
      },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))

    expect(result.current.betaOnly).toBe(true)
    expect(result.current.window?.from).toBe(END - DAY)
    expect(result.current.window?.to).toBe(END)
    // The figures stay, without the stray day: the range starts at 1,210, not 1.
    expect(result.current.attestations).toEqual({ state: "ready", value: { mean: 2289, min: 1210, max: 3367, days: 2 }, source: "subgraph" })
  })

  it("says nothing about Beta once the Aegis contracts are indexed and hold Aegis days", async () => {
    indexed.programme = "aegis"
    vi.setSystemTime(noon(START + 7 * DAY))
    const d = (date: number) => ({ date, attestations: "4000", attestationCeremonies: "400", latencyBuckets: ["0", "1"] })
    answerOperations({
      ConsensusWindow: { ...window(), firstDay: [{ date: START }], consensusDays: [d(START + 6 * DAY), d(START + 5 * DAY), d(START)], validatorDays: [] },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))
    expect(result.current.betaOnly).toBe(false)
    expect(result.current.window?.to).toBe(START + 6 * DAY)
    expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ variables: { days: CONSENSUS_QUERY_DAYS, until: 2_147_483_647 } }))
  })

  it("says the snapshot describes Beta: it was measured before Aegis", async () => {
    answerOperations({ ConsensusWindow: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))
    expect(result.current.betaOnly).toBe(true)
  })

  it("says nothing about Beta while it is still loading", () => {
    mockRequest.mockReturnValue(new Promise(() => {}))
    const { result } = render()
    expect(result.current.betaOnly).toBe(false)
  })

  it("shows the snapshot when the subgraph fails", async () => {
    answerOperations({ ConsensusWindow: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.attestations.state).toBe("ready"))
    expect(result.current.attestations.state === "ready" && result.current.attestations.source).toBe("snapshot")
    expect(result.current.snapshotReason).toBe("The subgraph could not be queried.")
  })
})
