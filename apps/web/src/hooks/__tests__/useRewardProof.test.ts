import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { renderHook } from "@testing-library/react"
import type { Address } from "viem"
import { heldPendingCompliance, type RewardProof } from "../useRewardProof"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

let capturedOptions:
  | {
      queryKey?: unknown[]
      queryFn?: () => Promise<unknown>
      enabled?: boolean
      staleTime?: number
      retry?: boolean
    }
  | undefined

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts: Record<string, unknown>) => {
    capturedOptions = opts as typeof capturedOptions
    return { data: undefined }
  }),
}))

describe("useRewardProof", () => {
  let useRewardProof: (address: Address | undefined, enabled?: boolean) => { data: unknown }
  let useQueryMock: Mock

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    capturedOptions = undefined
    ;({ useRewardProof } = await import("../useRewardProof"))
    const reactQuery = await import("@tanstack/react-query")
    useQueryMock = reactQuery.useQuery as unknown as Mock
  })

  describe("query configuration", () => {
    it("is disabled when address is undefined", () => {
      renderHook(() => useRewardProof(undefined))

      expect(useQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })

    it("is enabled when address is provided", () => {
      renderHook(() =>
        useRewardProof("0x1234567890123456789012345678901234567890" as Address),
      )

      expect(useQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      )
    })

    it("is disabled when enabled=false is passed", () => {
      renderHook(() =>
        useRewardProof(
          "0x1234567890123456789012345678901234567890" as Address,
          false,
        ),
      )

      expect(useQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      )
    })
  })

  describe("queryFn", () => {
    const address = "0x0484bf598554ab04b9b21421ed28bff6b7742993" as Address

    beforeEach(() => {
      useQueryMock.mockImplementation((opts: Record<string, unknown>) => {
        capturedOptions = opts as typeof capturedOptions
        return { data: undefined }
      })
      renderHook(() => useRewardProof(address))
    })

    async function callQueryFn() {
      return capturedOptions!.queryFn!()
    }

    it("returns null on 404", async () => {
      mockFetch.mockResolvedValueOnce({ status: 404 })

      const result = await callQueryFn()

      expect(result).toBeNull()
    })

    it("throws on non-404 error responses", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

      await expect(callQueryFn()).rejects.toThrow(
        "Failed to fetch reward proof: 500",
      )
    })

    it("throws on invalid proof format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ cumulativeAmount: 123 }),
      })

      await expect(callQueryFn()).rejects.toThrow("Invalid reward proof format")
    })

    it("accepts a minimal valid proof", async () => {
      const proof = {
        cumulativeAmount: "1000",
        merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
        proof: ["0x1998aa1fb0e54f96da60317f799a85422585dda3a8368e6af3a465c3dd455e50"],
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => proof,
      })

      const result = await callQueryFn()

      expect(result).toMatchObject(proof)
    })

    it("accepts proof with proof:null (kycAmount pending, nothing claimable yet)", async () => {
      const proof = {
        cumulativeAmount: "0",
        kycAmount: "826720638286750773563",
        merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
        proof: null,
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => proof,
      })

      const result = await callQueryFn()

      expect(result).toMatchObject(proof)
    })

    it("accepts proof with kyc:true and kycAmount:0", async () => {
      const proof = {
        cumulativeAmount: "973890821912297403820",
        kyc: true,
        kycAmount: "0",
        merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
        proof: ["0x1998aa1fb0e54f96da60317f799a85422585dda3a8368e6af3a465c3dd455e50"],
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => proof,
      })

      const result = await callQueryFn()

      expect(result).toMatchObject(proof)
    })

    it("rejects proof with non-string kycAmount", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          cumulativeAmount: "0",
          kycAmount: 12345,
          merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
          proof: null,
        }),
      })

      await expect(callQueryFn()).rejects.toThrow("Invalid reward proof format")
    })

    it("rejects proof with non-numeric kycAmount string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          cumulativeAmount: "0",
          kycAmount: "not-a-number",
          merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
          proof: null,
        }),
      })

      await expect(callQueryFn()).rejects.toThrow("Invalid reward proof format")
    })

    it("rejects proof with non-boolean kyc", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          cumulativeAmount: "0",
          kyc: "yes",
          merkleRoot: "0x5aea53631d726e3cb245cb1ce31834212ab6667a4726d25168a583d3b57b6cc1",
          proof: null,
        }),
      })

      await expect(callQueryFn()).rejects.toThrow("Invalid reward proof format")
    })

    describe("null KYC fields, treated as absent", () => {
      // Copied verbatim from SEF's live file for this address on 2026-10-04 (it carries
      // kyc:true there). No live file has a null today; these guard against SEF starting to.
      const LIVE_FILE = {
        cumulativeAmount: "510829662710406536434166",
        kyc: true,
        kycAmount: "0",
        merkleRoot: "0xf806466669f4d3464fb8b4e6edde9027c0edbc9c899c8d3371756237a7439fa8",
        proof: [
          "0x65f83a6e71d4df7fd11f046d7cb7f4f5ff61f240f03c9efeeed846b3262da0c8",
          "0xd08bb9cc6458408f2241d0540aac5d87976ed46d3b96db001420a6a10934a88a",
          "0x8e69ab4e28e6bd4afd46339acc6a28a20a6b9e0f040ee631f9999034fc6ff9ab",
          "0x33c272587fc31d022f519393880d56edccfc8ca665abbf5cbe7f0a9d2d434af5",
          "0x5b7fdb680082064c9c58728b452bf264c388fa81b313fdce7fb2d878e522a434",
          "0x85b42f604804932cace08fc78816ec997a103e1ad97280c91d19f92e1af00150",
          "0xba70a2cb3f7279c82a08fd1c515ffad4a35371ea8c138bf24bee73cad92618c1",
          "0xb5a67f4f80030d6f13cb7fcbdf75d5fa241bfe118d7a4d19de1c5b0ed7d375e5",
        ],
      }

      async function validates(file: Record<string, unknown>) {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => file })
        return callQueryFn()
      }

      it("accepts the live file unchanged", async () => {
        await expect(validates(LIVE_FILE)).resolves.toEqual(LIVE_FILE)
      })

      it("accepts kyc: null", async () => {
        const file = { ...LIVE_FILE, kyc: null }
        const proof = (await validates(file)) as RewardProof
        expect(proof).toEqual(file)
        expect(heldPendingCompliance(proof)).toBe(0n)
      })

      it("accepts kycAmount: null, and holds nothing", async () => {
        const file = { ...LIVE_FILE, kycAmount: null, kyc: null }
        const proof = (await validates(file)) as RewardProof
        expect(proof).toEqual(file)
        expect(heldPendingCompliance(proof)).toBe(0n)
      })

      it("still rejects other wrong types for kyc and kycAmount", async () => {
        await expect(validates({ ...LIVE_FILE, kyc: 0 })).rejects.toThrow("Invalid reward proof format")
        await expect(validates({ ...LIVE_FILE, kycAmount: false })).rejects.toThrow("Invalid reward proof format")
      })
    })
  })
})

describe("heldPendingCompliance", () => {
  const base: RewardProof = {
    cumulativeAmount: "1000",
    merkleRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
    proof: null,
  }

  it("is the kycAmount while the address is not marked as checked", () => {
    expect(heldPendingCompliance({ ...base, kycAmount: "500" })).toBe(500n)
    expect(heldPendingCompliance({ ...base, kycAmount: "500", kyc: false })).toBe(500n)
  })

  it("counts kyc: null as not checked, so the amount is held", () => {
    expect(heldPendingCompliance({ ...base, kycAmount: "500", kyc: null })).toBe(500n)
  })

  it("is zero once the file marks the address as checked", () => {
    expect(heldPendingCompliance({ ...base, kycAmount: "500", kyc: true })).toBe(0n)
  })

  it("is zero without a held amount or without a file", () => {
    expect(heldPendingCompliance({ ...base, kycAmount: "0" })).toBe(0n)
    expect(heldPendingCompliance({ ...base, kycAmount: null })).toBe(0n)
    expect(heldPendingCompliance(base)).toBe(0n)
    expect(heldPendingCompliance(null)).toBe(0n)
    expect(heldPendingCompliance(undefined)).toBe(0n)
  })
})
