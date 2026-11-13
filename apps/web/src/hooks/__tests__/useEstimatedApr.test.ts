import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useEstimatedApr } from "../useEstimatedApr"

const SAFE = 10n ** 18n
const mocks = vi.hoisted(() => ({ latest: vi.fn(), history: vi.fn() }))
vi.mock("../useProgrammeRewards", () => ({ useProgrammeRewards: () => ({ latest: mocks.latest() }) }))
vi.mock("../useSubgraphQuery", () => ({ useSubgraphQuery: () => mocks.history() }))

/** SEF's first Aegis file, as served on 2026-11-11. */
const FILE = {
  epoch: 0,
  merkleRoot: "0x" + "ab".repeat(32),
  rewardsUntil: "2026-10-27T00:00:00.000Z",
  tokenTotal: "4723064697884593348124545",
  sentinelTokenTotal: "30769230769230769230768",
  unpaidAmount: "500",
}
const LIVE = {
  status: "live",
  data: { dayDatas: [{ date: Date.UTC(2026, 9, 1) / 1000, totalStaked: (70_000_000n * SAFE).toString() }] },
  freshness: { block: 26_393_917, blockTimestamp: Date.UTC(2026, 10, 11) / 1000, ageSeconds: 12, checkedAt: Date.UTC(2026, 10, 11), hasIndexingErrors: false },
}

describe("useEstimatedApr", () => {
  beforeEach(() => {
    mocks.latest.mockReturnValue({ data: FILE, error: null })
    mocks.history.mockReturnValue(LIVE)
  })
  it("estimates from SEF's file and the subgraph's daily stake", () => {
    const { result } = renderHook(() => useEstimatedApr())
    expect(result.current.state).toBe("ready")
    if (result.current.state !== "ready") return
    expect(result.current.source).toBe("sef")
    expect(result.current.value.apr).toBeCloseTo((192_307.692307692 / 70_000_000) * (365 / 14), 8)
  })

  it("is loading until both inputs answer", () => {
    mocks.latest.mockReturnValue({ data: undefined, error: null })
    expect(renderHook(() => useEstimatedApr()).result.current).toEqual({ state: "loading" })
    mocks.latest.mockReturnValue({ data: FILE, error: null })
    mocks.history.mockReturnValue({ status: "loading" })
    expect(renderHook(() => useEstimatedApr()).result.current).toEqual({ state: "loading" })
  })

  it("names the input that failed", () => {
    mocks.latest.mockReturnValue({ data: undefined, error: new Error("HTTP 502") })
    expect(renderHook(() => useEstimatedApr()).result.current).toEqual({
      state: "unavailable",
      reason: "SEF's published rewards file could not be loaded.",
    })
    mocks.latest.mockReturnValue({ data: FILE, error: null })
    mocks.history.mockReturnValue({ status: "degraded", degradation: { kind: "failed", message: "down" } })
    const result = renderHook(() => useEstimatedApr()).result.current
    expect(result.state).toBe("unavailable")
    if (result.state === "unavailable") expect(result.reason).toMatch(/The estimate needs the subgraph's daily total staked\.$/)
  })

  it("gives the method's reason in a sentence, judged at the subgraph's answer", () => {
    mocks.history.mockReturnValue({ ...LIVE, freshness: { ...LIVE.freshness, checkedAt: Date.UTC(2026, 11, 1) } })
    expect(renderHook(() => useEstimatedApr()).result.current).toEqual({
      state: "unavailable",
      reason: "SEF's latest reward period ended too long ago to describe the current rate.",
    })
  })
})
