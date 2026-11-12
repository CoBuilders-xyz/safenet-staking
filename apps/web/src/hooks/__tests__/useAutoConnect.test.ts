import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAutoConnect } from "../useAutoConnect"

const connect = vi.fn()
const reconnect = vi.fn()
vi.mock("wagmi", () => ({
  useConnect: () => ({ connect, connectors: [] }),
  useReconnect: () => ({ reconnect }),
}))

beforeEach(() => {
  connect.mockClear()
  reconnect.mockClear()
})

describe("useAutoConnect", () => {
  it("restores the last wallet once", () => {
    const { rerender } = renderHook(() => useAutoConnect())
    rerender()

    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it("contacts no wallet while it is off, and connects once when it turns on", () => {
    const { rerender } = renderHook(({ enabled }) => useAutoConnect(enabled), { initialProps: { enabled: false } })
    expect(reconnect).not.toHaveBeenCalled()

    rerender({ enabled: true })
    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
  })
})
