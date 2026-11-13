import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useTermsGuard } from "../useTermsGuard"

const disconnect = vi.fn()
const state = vi.hoisted(() => ({ connections: [] as { connector: { id: string } }[] }))
vi.mock("wagmi", () => ({
  useConnections: () => state.connections,
  useDisconnect: () => ({ disconnect }),
}))

const browserWallet = { connector: { id: "browserWallet" } }
const discovered = { connector: { id: "io.metamask" } }

beforeEach(() => {
  disconnect.mockClear()
  state.connections = []
})

describe("useTermsGuard", () => {
  it("drops every connection a wallet made by itself while the terms are not accepted", () => {
    const { rerender } = renderHook(({ accepted }) => useTermsGuard(accepted), { initialProps: { accepted: false } })
    expect(disconnect).not.toHaveBeenCalled()

    // One wallet, registered twice: as the browser wallet and through EIP-6963 discovery.
    state.connections = [browserWallet, discovered]
    rerender({ accepted: false })
    expect(disconnect.mock.calls.map(([arg]) => arg)).toEqual([{ connector: browserWallet.connector }, { connector: discovered.connector }])
  })

  it("drops the connection that is left when wagmi falls back to it", () => {
    state.connections = [browserWallet, discovered]
    const { rerender } = renderHook(() => useTermsGuard(false))
    disconnect.mockClear()

    state.connections = [discovered]
    rerender()
    expect(disconnect).toHaveBeenCalledWith({ connector: discovered.connector })
  })

  it("leaves connections alone under accepted terms", () => {
    state.connections = [browserWallet]
    renderHook(() => useTermsGuard(true))

    expect(disconnect).not.toHaveBeenCalled()
  })
})
