import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import type { RewardProof } from "../useRewardProof"
import { useRewards } from "../useRewards"

const SAFE = 10n ** 18n
const ROOT = "0x" + "ab".repeat(32)

const mockUseReadContract = vi.fn()
const mockUseRewardProof = vi.fn()

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: TEST_ACCOUNTS.user }),
  useReadContract: (...args: unknown[]) => mockUseReadContract(...args),
}))

vi.mock("../useRewardProof", () => ({
  useRewardProof: (...args: unknown[]) => mockUseRewardProof(...args),
}))

function proof(merkleRoot: string): RewardProof {
  return {
    cumulativeAmount: (100n * SAFE).toString(),
    merkleRoot: merkleRoot as `0x${string}`,
    proof: [("0x" + "11".repeat(32)) as `0x${string}`],
  }
}

/** Route each read to a result by function name, so the order of calls does not matter. */
function chainReturns(results: Record<string, unknown>) {
  mockUseReadContract.mockImplementation((opts: { functionName: string }) => ({
    data: results[opts.functionName],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }))
}

describe("useRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRewardProof.mockReturnValue({ data: proof(ROOT), isLoading: false, error: null, refetch: vi.fn() })
    chainReturns({ cumulativeClaimed: 40n * SAFE, merkleRoot: ROOT })
  })

  it("computes the claimable amount from the proof and the claimed amount", () => {
    const { result } = renderHook(() => useRewards())

    expect(result.current.data).toEqual({
      claimable: 60n * SAFE,
      totalClaimed: 40n * SAFE,
      canClaim: true,
      rootStale: false,
    })
  })

  it("treats roots that differ only in letter case as the same root", () => {
    // viem returns bytes32 in lower case; SEF's file is free to use upper case.
    mockUseRewardProof.mockReturnValue({
      data: proof("0x" + "AB".repeat(32)),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    const { result } = renderHook(() => useRewards())

    expect(result.current.data.rootStale).toBe(false)
    expect(result.current.data.canClaim).toBe(true)
  })

  it("marks the proof stale and blocks the claim when the roots differ", () => {
    chainReturns({ cumulativeClaimed: 40n * SAFE, merkleRoot: "0x" + "cd".repeat(32) })
    const { result } = renderHook(() => useRewards())

    expect(result.current.data.rootStale).toBe(true)
    expect(result.current.data.canClaim).toBe(false)
  })

  it("does not call the proof stale before the on-chain root is read", () => {
    chainReturns({ cumulativeClaimed: 40n * SAFE })
    const { result } = renderHook(() => useRewards())

    expect(result.current.data.rootStale).toBe(false)
  })

  it("passes the proof through, with null meaning the address never earned", () => {
    mockUseRewardProof.mockReturnValue({ data: null, isLoading: false, error: null, refetch: vi.fn() })
    const { result } = renderHook(() => useRewards())

    expect(result.current.proof).toBeNull()
    expect(result.current.data.canClaim).toBe(false)
  })

  it("surfaces a failed proof fetch as the hook's error", () => {
    const failure = new Error("Failed to fetch reward proof: 500")
    mockUseRewardProof.mockReturnValue({ data: undefined, isLoading: false, error: failure, refetch: vi.fn() })
    const { result } = renderHook(() => useRewards())

    expect(result.current.error).toBe(failure)
  })
})
