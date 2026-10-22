import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { SEF_DATA } from "@cobuilders/safenet-core"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { findValidator } from "../useValidators"

const mockFetch = vi.fn()

// Capture queryFn from each useQuery call so tests can invoke it directly.
let capturedQueryFn: (() => Promise<unknown>) | undefined

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts: { queryFn?: () => Promise<unknown> }) => {
    capturedQueryFn = opts.queryFn
    return { data: undefined, isLoading: true }
  }),
}))

const { useValidators } = await import("../useValidators")
const reactQuery = vi.mocked(await import("@tanstack/react-query"))

describe("useValidators", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedQueryFn = undefined
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("calls useQuery with validators key and 5 min staleTime", () => {
    renderHook(() => useValidators())

    expect(reactQuery.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["validators"],
        staleTime: 5 * 60 * 1000,
      })
    )
  })

  it("queryFn fetches and normalizes validator data", async () => {
    const rawData = [
      {
        address: "0x1111111111111111111111111111111111111111",
        label: "Validator A",
        commission: 0.05,
        is_active: true,
        participation_rate_14d: 0.8523,
      },
    ]
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(rawData)),
    })

    renderHook(() => useValidators())
    expect(capturedQueryFn).toBeDefined()
    const result = await capturedQueryFn!()

    expect(result).toEqual([
      {
        address: "0x1111111111111111111111111111111111111111",
        isActive: true,
        label: "Validator A",
        commission: 5,
        participationRate: 85.23,
      },
    ])
  })

  it("queryFn fetches SEF's published file, from core, when no URL is configured", async () => {
    vi.stubEnv("VITE_VALIDATOR_INFO_URL", "")
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("[]") })

    renderHook(() => useValidators())
    await capturedQueryFn!()

    expect(mockFetch).toHaveBeenCalledWith(SEF_DATA.validatorInfo)
  })

  it("queryFn fetches VITE_VALIDATOR_INFO_URL when it is set", async () => {
    vi.stubEnv("VITE_VALIDATOR_INFO_URL", "https://validators.example/validators.json")
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("[]") })

    renderHook(() => useValidators())
    await capturedQueryFn!()

    expect(mockFetch).toHaveBeenCalledWith("https://validators.example/validators.json")
  })

  it("queryFn throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    renderHook(() => useValidators())
    expect(capturedQueryFn).toBeDefined()
    await expect(capturedQueryFn!()).rejects.toThrow(
      "Failed to fetch validators: 500"
    )
  })

  it("queryFn throws on non-array response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ not: "an array" })),
    })

    renderHook(() => useValidators())
    expect(capturedQueryFn).toBeDefined()
    await expect(capturedQueryFn!()).rejects.toThrow(
      "Invalid validator data format"
    )
  })

  it("queryFn skips entries with missing required fields", async () => {
    const rawData = [
      { address: "0x1111111111111111111111111111111111111111", label: "Valid" },
      { address: "0x2222222222222222222222222222222222222222" }, // missing label
      { label: "No Address" }, // missing address
      null,
    ]
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(rawData)),
    })

    renderHook(() => useValidators())
    const result = await capturedQueryFn!()

    expect(result).toHaveLength(1)
    expect((result as Array<{ label: string }>)[0].label).toBe("Valid")
  })

  it("queryFn handles JSON with stray commas", async () => {
    const jsonWithCommas = `[
      {"address":"0x1111111111111111111111111111111111111111","label":"A"},
      ,
      {"address":"0x2222222222222222222222222222222222222222","label":"B"}
    ]`
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(jsonWithCommas),
    })

    renderHook(() => useValidators())
    const result = await capturedQueryFn!()
    expect(result).toHaveLength(2)
  })

  it("queryFn keeps a null rate null, as SEF publishes it since 2026-10-20, never 0", async () => {
    // validator-info.json as live on 2026-10-22: labels, flags, commissions and the null rates
    // copied from the file; two of its six entries, at the shared fixture addresses.
    const live = [
      { address: TEST_ACCOUNTS.validator1, commission: 0.05, is_active: true, label: "Gnosis", participation_rate_14d: null },
      { address: TEST_ACCOUNTS.validator2, commission: 0.05, is_active: false, label: "RockawayX", participation_rate_14d: null },
    ]
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(live)) })

    renderHook(() => useValidators())
    const result = (await capturedQueryFn!()) as Array<{ label: string; isActive: boolean; participationRate: number | null }>

    expect(result.map((v) => [v.label, v.isActive, v.participationRate])).toEqual([
      ["Gnosis", true, null],
      ["RockawayX", false, null],
    ])
  })

  it("queryFn defaults missing commission to 0 and a missing rate to null", async () => {
    const rawData = [
      {
        address: "0x1111111111111111111111111111111111111111",
        label: "Minimal",
      },
    ]
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(rawData)),
    })

    renderHook(() => useValidators())
    const result = (await capturedQueryFn!()) as Array<{
      commission: number
      participationRate: number | null
      isActive: boolean
    }>

    expect(result[0].commission).toBe(0)
    expect(result[0].participationRate).toBeNull()
    expect(result[0].isActive).toBe(true)
  })
})

describe("findValidator", () => {
  const validators = [
    {
      address: "0x1234567890AbcdEF1234567890aBcdef12345678" as `0x${string}`,
      isActive: true,
      label: "Test",
      commission: 5,
      participationRate: 85,
    },
  ]

  it("finds validator by lowercase address", () => {
    const result = findValidator(validators, "0x1234567890abcdef1234567890abcdef12345678")
    expect(result).toEqual(validators[0])
  })

  it("finds validator case-insensitively", () => {
    const result = findValidator(validators, "0x1234567890ABCDEF1234567890ABCDEF12345678")
    expect(result).toEqual(validators[0])
  })

  it("returns null for unknown address", () => {
    const result = findValidator(validators, "0x0000000000000000000000000000000000000099")
    expect(result).toBeNull()
  })

  it("returns null when validators is undefined", () => {
    const result = findValidator(undefined, "0x1234567890abcdef1234567890abcdef12345678")
    expect(result).toBeNull()
  })
})
