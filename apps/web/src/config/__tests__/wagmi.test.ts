import { describe, it, expect, vi } from "vitest"
import { SAFE_INFO_TIMEOUT_MS } from "@/lib/safe"

vi.mock("wagmi/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi/connectors")>()
  return { ...actual, safe: vi.fn(actual.safe) }
})

describe("wagmi config", () => {
  it("gives Safe{Wallet} SAFE_INFO_TIMEOUT_MS to answer, not wagmi's 10 ms default", async () => {
    const { safe } = await import("wagmi/connectors")
    const { config } = await import("../wagmi")
    expect(safe).toHaveBeenCalledWith(expect.objectContaining({ unstable_getInfoTimeout: SAFE_INFO_TIMEOUT_MS }))
    expect(config.connectors[0].id).toBe("safe")
  })

  it("waits longer than the slowest Safe{Wallet} answer measured, 1,060 ms", () => {
    expect(SAFE_INFO_TIMEOUT_MS).toBeGreaterThan(1_060)
  })
})
