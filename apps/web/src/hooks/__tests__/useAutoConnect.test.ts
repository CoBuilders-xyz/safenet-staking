import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAutoConnect } from "../useAutoConnect"

const connect = vi.fn()
const reconnect = vi.fn()
const safeConnector = { id: "safe" }
const safe = vi.hoisted(() => ({ isSafeApp: false }))
vi.mock("wagmi", () => ({
  useConnect: () => ({ connect, connectors: [safeConnector] }),
  useReconnect: () => ({ reconnect }),
}))
vi.mock("@/lib/safe", () => ({
  get isSafeApp() {
    return safe.isSafeApp
  },
}))

beforeEach(() => {
  connect.mockClear()
  reconnect.mockClear()
  safe.isSafeApp = false
})

const render = (enabled: boolean, termsAccepted: boolean) =>
  renderHook(({ enabled, termsAccepted }) => useAutoConnect(enabled, termsAccepted), { initialProps: { enabled, termsAccepted } })

describe("useAutoConnect", () => {
  it("restores the last wallet once", () => {
    const { rerender } = renderHook(() => useAutoConnect())
    rerender()

    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it("contacts no wallet while it is off, and connects once when it turns on", () => {
    const { rerender } = render(false, true)
    expect(reconnect).not.toHaveBeenCalled()

    rerender({ enabled: true, termsAccepted: true })
    rerender({ enabled: false, termsAccepted: true })
    rerender({ enabled: true, termsAccepted: true })
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(connect).not.toHaveBeenCalled()
  })

  it("restores no session without accepted terms, not even once they are accepted: the visitor connects by hand", () => {
    const { rerender } = render(true, false)
    rerender({ enabled: true, termsAccepted: true })

    expect(reconnect).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it("inside Safe, waits for the terms and then connects the Safe connector once", () => {
    safe.isSafeApp = true
    const { rerender } = render(true, false)
    expect(connect).not.toHaveBeenCalled()

    rerender({ enabled: true, termsAccepted: true })
    rerender({ enabled: true, termsAccepted: true })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith({ connector: safeConnector })
    expect(reconnect).not.toHaveBeenCalled()
  })
})
