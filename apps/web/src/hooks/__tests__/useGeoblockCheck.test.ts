import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { renderHook } from "@testing-library/react"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

let capturedQueryFn: (() => Promise<unknown>) | undefined

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts: Record<string, unknown>) => {
    capturedQueryFn = opts.queryFn as (() => Promise<unknown>) | undefined
    return { data: undefined, isLoading: true, isError: false }
  }),
}))

const { useGeoblockCheck } = await import("../useGeoblockCheck")
const reactQuery = await import("@tanstack/react-query")
const useQueryMock = reactQuery.useQuery as unknown as Mock

describe("useGeoblockCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    localStorage.clear()
    capturedQueryFn = undefined
  })

  describe("hook return values", () => {
    it("returns allowed=true and isLoading=true while loading", () => {
      useQueryMock.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      })

      const { result } = renderHook(() => useGeoblockCheck())

      expect(result.current.isLoading).toBe(true)
      expect(result.current.allowed).toBe(true)
    })

    it("returns allowed=true for non-blocked country", () => {
      useQueryMock.mockReturnValue({
        data: "US",
        isLoading: false,
        isError: false,
      })

      const { result } = renderHook(() => useGeoblockCheck())

      expect(result.current.isLoading).toBe(false)
      expect(result.current.allowed).toBe(true)
      expect(result.current.restriction).toBeUndefined()
    })

    it("returns allowed=false for blocked country (Iran)", () => {
      useQueryMock.mockReturnValue({
        data: "IR",
        isLoading: false,
        isError: false,
      })

      const { result } = renderHook(() => useGeoblockCheck())

      expect(result.current.allowed).toBe(false)
      expect(result.current.restriction).toEqual({ gate: "geoblock", reason: "region", country: "IR" })
    })

    it("returns allowed=false for blocked country (Russia)", () => {
      useQueryMock.mockReturnValue({
        data: "RU",
        isLoading: false,
        isError: false,
      })

      const { result } = renderHook(() => useGeoblockCheck())

      expect(result.current.allowed).toBe(false)
    })

    it("returns allowed=false on error (fail-closed)", () => {
      useQueryMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      })

      const { result } = renderHook(() => useGeoblockCheck())

      expect(result.current.allowed).toBe(false)
      expect(result.current.restriction).toEqual({ gate: "geoblock", reason: "unavailable" })
    })

    it.each(["ru", "Russia", { code: "RU" }])("fails closed for invalid query data %j", (country) => {
      useQueryMock.mockReturnValue({ data: country, isLoading: false, isError: false })
      const { result } = renderHook(() => useGeoblockCheck())
      expect(result.current.allowed).toBe(false)
      expect(result.current.restriction).toEqual({ gate: "geoblock", reason: "unavailable" })
    })
  })

  describe("queryFn (fetchCountry)", () => {
    beforeEach(() => {
      useQueryMock.mockImplementation(
        (opts: Record<string, unknown>) => {
          capturedQueryFn = opts.queryFn as
            | (() => Promise<unknown>)
            | undefined
          return {
            data: undefined,
            isLoading: true,
            isError: false,
          }
        },
      )
      renderHook(() => useGeoblockCheck())
    })

    it("fetches from API when no cache exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ country: "US" }),
      })

      const country = await capturedQueryFn!()

      expect(country).toBe("US")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("returns cached country and skips fetch", async () => {
      const cached = { country: "DE", timestamp: Date.now() }
      localStorage.setItem("geoblock_check", JSON.stringify(cached))

      const country = await capturedQueryFn!()

      expect(country).toBe("DE")
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it("ignores expired cache and fetches fresh data", async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
      localStorage.setItem(
        "geoblock_check",
        JSON.stringify({ country: "US", timestamp: eightDaysAgo }),
      )

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ country: "FR" }),
      })

      const country = await capturedQueryFn!()

      expect(country).toBe("FR")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("writes to cache after successful fetch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ country: "FR" }),
      })

      await capturedQueryFn!()

      const stored = JSON.parse(localStorage.getItem("geoblock_check")!)
      expect(stored.country).toBe("FR")
      expect(stored.timestamp).toBeGreaterThan(0)
    })

    it("falls back to ipapi.co when country.is fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("US"),
      })

      const country = await capturedQueryFn!()

      expect(country).toBe("US")
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it.each(["ru", "Russia", 123, { code: "RU" }, null, undefined])(
      "rejects malformed primary country %j and uses the fallback",
      async (country) => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ country }) })
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "RU" })

        await expect(capturedQueryFn!()).resolves.toBe("RU")
        expect(mockFetch).toHaveBeenCalledTimes(2)
      },
    )

    it("fails closed when a malformed primary response has no working fallback", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ country: { code: "RU" } }) })
      mockFetch.mockRejectedValueOnce(new Error("Network error"))

      await expect(capturedQueryFn!()).rejects.toThrow()
      expect(localStorage.getItem("geoblock_check")).toBeNull()
    })

    it.each([
      { country: "ru", timestamp: Date.now() },
      { country: { code: "RU" }, timestamp: Date.now() },
      { country: "US" },
      { country: "US", timestamp: "not a timestamp" },
      { country: "US", timestamp: Date.now() + 86_400_000 },
    ])("ignores malformed cached lookup %j", async (cached) => {
      localStorage.setItem("geoblock_check", JSON.stringify(cached))
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ country: "RU" }) })

      await expect(capturedQueryFn!()).resolves.toBe("RU")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("throws when both providers fail", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

      await expect(capturedQueryFn!()).rejects.toThrow("ipapi.co lookup failed")
      expect(localStorage.getItem("geoblock_check")).toBeNull()
    })

    it("throws on network error from both providers", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"))
      mockFetch.mockRejectedValueOnce(new Error("Network error"))

      await expect(capturedQueryFn!()).rejects.toThrow("Network error")
      expect(localStorage.getItem("geoblock_check")).toBeNull()
    })

    it("ignores corrupted cache and fetches fresh data", async () => {
      localStorage.setItem("geoblock_check", "not-valid-json")

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ country: "US" }),
      })

      const country = await capturedQueryFn!()

      expect(country).toBe("US")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("useQuery configuration", () => {
    it("passes correct query key and options", () => {
      renderHook(() => useGeoblockCheck())

      expect(useQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["geoblock"],
          retry: false,
        }),
      )
    })
  })
})
