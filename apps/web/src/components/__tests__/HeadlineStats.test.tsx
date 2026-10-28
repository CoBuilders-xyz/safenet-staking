import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"
import { answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { HeadlineStats } from "../overview/OverviewSections"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))
// The state these tests describe: the Gnosis figures come from Beta's rows. Core names Aegis.
vi.mock("@cobuilders/safenet-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cobuilders/safenet-core")>()),
  GNOSIS_INDEXED_PROGRAMME: "beta",
}))
vi.mock("@/hooks/useNetworkTotals", () => ({
  useNetworkTotals: () => ({ totalStaked: { state: "loading" }, validatorCounts: { state: "loading" } }),
}))

const DAY = 86_400
/** Beta's last day, from core; no programme date is typed here. */
const END = utcDayMs(BETA_END_DAY) / 1000
/** The stray ceremony the Beta contract recorded after Beta ended: chain data, not a programme date. */
const STRAY = Date.parse("2026-10-06T00:00:00Z") / 1000
const day = (date: number, attestations: number) => ({
  date,
  attestations: String(attestations),
  attestationCeremonies: String(attestations),
  latencyBuckets: ["0", "0", "0", "0", "0", "9"],
})

/**
 * The Gnosis headline figures from the subgraph's real last days: Beta ended on 5 October with
 * 1,210 attestations, and the Beta contract recorded one stray ceremony on 6 October.
 */
describe("HeadlineStats at the end of Beta", () => {
  beforeEach(() => {
    mockRequest.mockReset()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date((END + 3 * DAY + DAY / 2) * 1000))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("labels the window as Beta ending on 5 October, and keeps the stray day out of the range", async () => {
    answerOperations({
      ConsensusWindow: {
        _meta: meta(10, 48_640_000),
        firstDay: [{ date: END - 3 * DAY }],
        consensusDays: [day(STRAY, 1), day(END, 1210), day(END - DAY, 3367), day(END - 2 * DAY, 3284)],
        validatorDays: [],
        programmeConsensus: [],
      },
    })
    render(<HeadlineStats />, { wrapper: queryWrapper() })

    const attestations = await screen.findByRole("group", { name: "Attestations per day" })
    await vi.waitFor(() => expect(attestations).toHaveTextContent("Beta, Sat 3 Oct 2026 to Mon 5 Oct 2026."))
    expect(attestations).toHaveTextContent("Mean over 3 complete days, range 1,210 to 3,367")
    expect(attestations).not.toHaveTextContent("Tue 6 Oct")
    expect(screen.getByRole("note", { name: "Beta ended" })).toHaveTextContent(
      "Beta ended on 5 October 2026. Aegis data starts on 13 October 2026.",
    )
  })
})
