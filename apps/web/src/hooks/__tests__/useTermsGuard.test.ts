import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useTermsGuard } from "../useTermsGuard"

const disconnect = vi.fn()
const account = vi.hoisted(() => ({ isConnected: false }))
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: account.isConnected }),
  useDisconnect: () => ({ disconnect }),
}))

beforeEach(() => {
  disconnect.mockClear()
  account.isConnected = false
})

describe("useTermsGuard", () => {
  it("drops a connection the wallet made by itself while the terms are not accepted", () => {
    const { rerender } = renderHook(({ accepted }) => useTermsGuard(accepted), { initialProps: { accepted: false } })
    expect(disconnect).not.toHaveBeenCalled()

    account.isConnected = true
    rerender({ accepted: false })
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it("leaves a connection alone under accepted terms", () => {
    account.isConnected = true
    renderHook(() => useTermsGuard(true))

    expect(disconnect).not.toHaveBeenCalled()
  })
})
