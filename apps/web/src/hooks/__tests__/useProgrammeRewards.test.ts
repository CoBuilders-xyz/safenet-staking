import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { SEF_DATA } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import {
  deriveProgramme,
  parseRewardsLatest,
  sameRoot,
  useProgrammeRewards,
} from "../useProgrammeRewards"

const SAFE = 10n ** 18n
const ROOT_A = "0x" + "ab".repeat(32)
const ROOT_B = "0x" + "cd".repeat(32)

/** The shape SEF publishes, with the live file's field set. */
const LATEST = {
  epoch: 0,
  merkleRoot: ROOT_A,
  rewardsUntil: "2026-09-22T00:00:00.000Z",
  tokenTotal: (1000n * SAFE).toString(),
  unpaidAmount: "15",
}

/**
 * SEF's latest.json as live on 2026-10-22, after it removed `updatedAt` on 2026-10-21: the
 * file's five fields and values, with a stand-in root.
 */
const LIVE_2026_10_22 = {
  epoch: 0,
  merkleRoot: ROOT_A,
  rewardsUntil: "2026-10-06T00:00:00.000Z",
  tokenTotal: "4499987774807670271201970",
  unpaidAmount: "12225192329728798030",
}

const mockUseReadContract = vi.fn()
const mockUseQuery = vi.fn()
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

vi.mock("wagmi", () => ({
  useReadContract: (...args: unknown[]) => mockUseReadContract(...args),
  usePublicClient: () => undefined,
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  // Resolves the reward source on every read. With no Mainnet client, that is the repository.
  useQueryClient: () => ({ fetchQuery: (o: { queryFn: () => unknown }) => o.queryFn() }),
}))

/** Route each read to a result by function name, so the order of calls does not matter. */
function readsReturn(results: Record<string, { data?: unknown; error?: unknown }>) {
  mockUseReadContract.mockImplementation((opts: { functionName: string }) => ({
    data: undefined,
    error: null,
    ...results[opts.functionName],
  }))
}

describe("parseRewardsLatest", () => {
  it("accepts the published shape", () => {
    expect(parseRewardsLatest(LATEST)).toEqual(LATEST)
  })

  it("accepts the file as live on 2026-10-22, which has no updatedAt", () => {
    expect(parseRewardsLatest(LIVE_2026_10_22)).toEqual(LIVE_2026_10_22)
  })

  it("accepts the first Aegis file, which adds sentinelTokenTotal, and rejects a malformed one", () => {
    const aegis = { ...LIVE_2026_10_22, rewardsUntil: "2026-10-27T00:00:00.000Z", sentinelTokenTotal: "30769230769230769230768" }
    expect(parseRewardsLatest(aegis)).toEqual(aegis)
    expect(() => parseRewardsLatest({ ...aegis, sentinelTokenTotal: "30769.2" })).toThrow("Invalid rewards file format")
    expect(() => parseRewardsLatest({ ...aegis, sentinelTokenTotal: 30769 })).toThrow("Invalid rewards file format")
  })

  it.each(Object.keys(LIVE_2026_10_22))("rejects the live file without %s", (field) => {
    const rest: Record<string, unknown> = { ...LIVE_2026_10_22 }
    delete rest[field]
    expect(() => parseRewardsLatest(rest)).toThrow("Invalid rewards file format")
  })

  it.each([
    ["a non-numeric epoch", { epoch: "0" }],
    ["a short root", { merkleRoot: "0xab" }],
    ["an unparseable period end", { rewardsUntil: "soon" }],
    ["a total that is not a decimal string", { tokenTotal: 1000 }],
    ["an unpaid amount with a decimal point", { unpaidAmount: "1.5" }],
  ])("rejects %s", (_, patch) => {
    expect(() => parseRewardsLatest({ ...LATEST, ...patch })).toThrow("Invalid rewards file format")
  })

  it("rejects a non-object", () => {
    expect(() => parseRewardsLatest(null)).toThrow("Invalid rewards file format")
  })
})

describe("deriveProgramme", () => {
  it("derives claimed and the unclaimed share from allocation and balance", () => {
    expect(deriveProgramme(1000n * SAFE, 300n * SAFE)).toEqual({
      allocated: 1000n * SAFE,
      unclaimed: 300n * SAFE,
      claimed: 700n * SAFE,
      unclaimedPercent: 30,
    })
  })

  it("keeps two decimals of the share", () => {
    // The live figures on 2026-10-04: 1,248,692.45 of 4,153,830.93 SAFE unclaimed.
    const totals = deriveProgramme(4153830931360190431300456n, 1248692458933614282022102n)
    expect(totals.unclaimedPercent).toBe(30.06)
    expect(totals.claimed).toBe(2905138472426576149278354n)
  })

  it("does not derive claims when the contract holds more than the allocation", () => {
    const totals = deriveProgramme(100n * SAFE, 150n * SAFE)
    expect(totals.claimed).toBeUndefined()
    expect(totals.unclaimedPercent).toBeUndefined()
    expect(totals.unclaimed).toBe(150n * SAFE)
  })

  it("does not divide by a zero allocation", () => {
    expect(deriveProgramme(0n, 0n).unclaimedPercent).toBeUndefined()
  })
})

describe("sameRoot", () => {
  it("ignores letter case", () => {
    expect(sameRoot(ROOT_A, ROOT_A.toUpperCase().replace("0X", "0x"))).toBe(true)
  })

  it("reports a difference", () => {
    expect(sameRoot(ROOT_A, ROOT_B)).toBe(false)
  })

  it("is undefined until both roots are known", () => {
    expect(sameRoot(ROOT_A, undefined)).toBeUndefined()
    expect(sameRoot(undefined, ROOT_A)).toBeUndefined()
  })
})

describe("useProgrammeRewards", () => {
  const { merkleDrop, token } = getContractAddresses(activeChain.id)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: undefined, error: null })
    readsReturn({})
  })

  it("reads the root from the MerkleDrop and its SAFE balance from the token", () => {
    renderHook(() => useProgrammeRewards())

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: merkleDrop, functionName: "merkleRoot" }),
    )
    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: token,
        functionName: "balanceOf",
        args: [merkleDrop],
      }),
    )
  })

  it("fetches SEF's latest.json and validates it", async () => {
    renderHook(() => useProgrammeRewards())
    const { queryKey, queryFn, select } = mockUseQuery.mock.calls[0][0] as {
      queryKey: unknown[]
      queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
      select: (answer: unknown) => unknown
    }
    const sourceOf = (mockUseQuery.mock.calls[1][0] as { select: (answer: unknown) => unknown }).select
    expect(queryKey).toEqual(["rewardsLatest"])
    const signal = new AbortController().signal

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => LATEST })
    const answer = await queryFn({ signal })
    expect(select(answer)).toEqual(LATEST)
    expect(sourceOf(answer)).toEqual({
      base: { url: SEF_DATA.rewardsProofBase, kind: "repository" },
      url: SEF_DATA.rewardsLatest,
      ens: { status: "unreadable", reason: "no Mainnet client" },
      tried: [{ base: { url: SEF_DATA.rewardsProofBase, kind: "repository" }, outcome: "found" }],
    })
    expect(String(mockFetch.mock.calls[0][0])).toBe(SEF_DATA.rewardsLatest)

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(queryFn({ signal })).rejects.toThrow("Failed to fetch rewards file: 404")

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(queryFn({ signal })).rejects.toThrow("Failed to fetch rewards file: 500")
  })

  it("has no totals until both the file and the balance are known", () => {
    mockUseQuery.mockReturnValue({ data: LATEST, error: null })
    const { result } = renderHook(() => useProgrammeRewards())

    expect(result.current.totals).toBeUndefined()
    expect(result.current.rootMatches).toBeUndefined()
  })

  it("derives totals and compares roots once everything is read", () => {
    mockUseQuery.mockReturnValue({ data: LATEST, error: null })
    readsReturn({ merkleRoot: { data: ROOT_A }, balanceOf: { data: 250n * SAFE } })
    const { result } = renderHook(() => useProgrammeRewards())

    expect(result.current.totals?.claimed).toBe(750n * SAFE)
    expect(result.current.totals?.unclaimedPercent).toBe(25)
    expect(result.current.rootMatches).toBe(true)
  })

  it("reports a differing root and derives no totals across two roots", () => {
    // SEF can publish a new root, with a larger tokenTotal, before it is set and funded on
    // chain. Allocated minus balance would then count unpaid rewards as claimed.
    mockUseQuery.mockReturnValue({ data: LATEST, error: null })
    readsReturn({ merkleRoot: { data: ROOT_B }, balanceOf: { data: 250n * SAFE } })
    const { result } = renderHook(() => useProgrammeRewards())

    expect(result.current.rootMatches).toBe(false)
    expect(result.current.totals).toBeUndefined()
  })

  it("derives no totals before the on-chain root is read", () => {
    mockUseQuery.mockReturnValue({ data: LATEST, error: null })
    readsReturn({ balanceOf: { data: 250n * SAFE } })
    const { result } = renderHook(() => useProgrammeRewards())

    expect(result.current.rootMatches).toBeUndefined()
    expect(result.current.totals).toBeUndefined()
  })

  it("keeps each source's error separate", () => {
    const failure = new Error("rpc down")
    mockUseQuery.mockReturnValue({ data: LATEST, error: null })
    readsReturn({ merkleRoot: { data: ROOT_A }, balanceOf: { error: failure } })
    const { result } = renderHook(() => useProgrammeRewards())

    expect(result.current.dropBalance.error).toBe(failure)
    expect(result.current.latest.error).toBeNull()
    expect(result.current.rootMatches).toBe(true)
  })
})
