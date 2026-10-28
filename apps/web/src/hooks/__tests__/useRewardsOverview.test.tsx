import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { MESSAGES } from "@/components/rewards/messages"
import { answerOperations, meta, mockRequest, queryWrapper, read } from "@/__tests__/subgraph-mocks"
import { rewardsMessages, useRewardsOverview } from "../useRewardsOverview"
import { i18n } from "@/i18n"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const { mockProgramme } = vi.hoisted(() => ({ mockProgramme: vi.fn() }))
vi.mock("@/hooks/useProgrammeRewards", () => ({ useProgrammeRewards: () => mockProgramme() }))
// useNetworkTotals is imported for its shared query only; its contract reads are not used here.
vi.mock("@/hooks/useStakingReads", () => ({ useTotalStaked: () => read(undefined) }))
vi.mock("@/hooks/useValidators", () => ({ useValidators: () => ({ data: undefined, error: null }) }))

const SAFE = 10n ** 18n
const ROOT = "0x" + "ab".repeat(32)
const NETWORK = { totalStaked: "0", stakersCurrent: 0, rewardsClaimed: (600n * SAFE).toString(), currentRoot: ROOT }

function programme(overrides: Record<string, unknown> = {}) {
  return {
    merkleDrop: "0x9999999999999999999999999999999999999999",
    latest: read({ tokenTotal: (1000n * SAFE).toString(), merkleRoot: ROOT }),
    onChainRoot: read(ROOT),
    dropBalance: read(400n * SAFE),
    totals: { allocated: 1000n * SAFE, unclaimed: 400n * SAFE, claimed: 600n * SAFE, unclaimedPercent: 40 },
    rootMatches: true,
    ...overrides,
  }
}

function render() {
  return renderHook(() => useRewardsOverview(), { wrapper: queryWrapper() })
}

describe("useRewardsOverview", () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockProgramme.mockReturnValue(programme())
  })

  it("takes claims from the subgraph and unclaimed as allocated minus claims", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(), network: { ...NETWORK, rewardsClaimed: (550n * SAFE).toString() } } })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("ready"))

    expect(result.current.allocated).toEqual({ state: "ready", value: 1000n * SAFE, source: "sef" })
    expect(result.current.claimed).toEqual({ state: "ready", value: 550n * SAFE, source: "subgraph" })
    expect(result.current.unclaimed).toEqual({ state: "ready", value: 450n * SAFE, source: "subgraph" })
    expect(result.current.rootMatches).toBe(true)
  })

  it("never shows a negative claimed total from the subgraph", async () => {
    answerOperations({ NetworkTotals: { _meta: meta(), network: { ...NETWORK, rewardsClaimed: "-5" } } })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("unavailable"))
    expect(result.current.claimed).toEqual({ state: "unavailable", reason: rewardsMessages(i18n.t).negativeClaims })
    expect(result.current.unclaimed).toEqual({ state: "unavailable", reason: rewardsMessages(i18n.t).negativeClaims })
  })

  it("will not derive unclaimed from the subgraph while the roots differ", async () => {
    mockProgramme.mockReturnValue(programme({ rootMatches: false, totals: undefined }))
    answerOperations({ NetworkTotals: { _meta: meta(), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("ready"))
    expect(result.current.unclaimed).toEqual({ state: "unavailable", reason: rewardsMessages(i18n.t).rootDiffers })
  })

  it("falls back to the MerkleDrop balance when the subgraph fails", async () => {
    answerOperations({ NetworkTotals: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("ready"))
    expect(result.current.claimed).toEqual({ state: "ready", value: 600n * SAFE, source: "contract" })
    expect(result.current.unclaimed).toEqual({ state: "ready", value: 400n * SAFE, source: "contract" })
  })

  it("is unavailable with the reason when the fallback cannot be read either", async () => {
    mockProgramme.mockReturnValue(programme({ dropBalance: read(undefined, new Error("rpc")), totals: undefined }))
    answerOperations({ NetworkTotals: new Error("down") })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("unavailable"))
    expect(result.current.claimed).toEqual({ state: "unavailable", reason: MESSAGES.contractReadFailed })
    expect(result.current.unclaimed).toEqual({ state: "unavailable", reason: MESSAGES.contractReadFailed })
  })

  it("says allocated is unavailable when SEF's file fails", async () => {
    mockProgramme.mockReturnValue(programme({ latest: read(undefined, new Error("404")), rootMatches: undefined, totals: undefined }))
    answerOperations({ NetworkTotals: { _meta: meta(), network: NETWORK } })
    const { result } = render()
    await waitFor(() => expect(result.current.claimed.state).toBe("ready"))
    expect(result.current.allocated).toEqual({ state: "unavailable", reason: MESSAGES.latestFileFailed })
    expect(result.current.unclaimed).toEqual({ state: "unavailable", reason: MESSAGES.latestFileFailed })
  })
})
