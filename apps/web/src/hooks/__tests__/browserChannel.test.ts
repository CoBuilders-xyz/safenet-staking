import { afterEach, describe, expect, it, vi } from "vitest"
import { browserChannel } from "../useAlerts"

afterEach(() => vi.unstubAllGlobals())

describe("browser push application-server key rotation", () => {
  function setup(oldKey: number[], unsubscribeResult = true) {
    const unsubscribe = vi.fn().mockResolvedValue(unsubscribeResult)
    const current = { options: { applicationServerKey: new Uint8Array(oldKey).buffer }, unsubscribe,
      toJSON: () => ({ endpoint: "https://push.test/old", keys: { auth: "old" } }) }
    const subscribe = vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: "https://push.test/new", keys: { auth: "new" } }) })
    const registration = { scope: "https://app.test/", active: { postMessage: vi.fn() },
      pushManager: { getSubscription: vi.fn().mockResolvedValue(current), subscribe } }
    vi.stubGlobal("isSecureContext", true)
    vi.stubGlobal("PushManager", class {})
    vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") })
    vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration) } })
    return { subscribe, unsubscribe }
  }

  it("reuses a subscription with the configured key", async () => {
    const { subscribe, unsubscribe } = setup([1, 2, 3])
    expect((await browserChannel("AQID")).endpoint).toBe("https://push.test/old")
    expect(subscribe).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it("replaces a subscription tied to the previous key", async () => {
    const { subscribe, unsubscribe } = setup([1, 2, 4])
    expect((await browserChannel("AQID")).endpoint).toBe("https://push.test/new")
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) })
  })

  it("does not save the stale endpoint when unsubscribe fails", async () => {
    const { subscribe } = setup([1, 2, 4], false)
    await expect(browserChannel("AQID")).rejects.toThrow("push")
    expect(subscribe).not.toHaveBeenCalled()
  })
})
