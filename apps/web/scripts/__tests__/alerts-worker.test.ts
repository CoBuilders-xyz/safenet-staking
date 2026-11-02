// @vitest-environment node
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, it, expect, vi } from "vitest"

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const cache = new Map<string, Response>()
  const showNotification = vi.fn(async () => {})
  const fetch = vi.fn(async () => new Response(null, { status: 200 }))
  const openWindow = vi.fn()
  runInNewContext(readFileSync(new URL("../../public/alerts-sw.js", import.meta.url), "utf8"), {
    URL, Response, fetch,
    caches: { open: async () => ({ put: async (key: URL, value: Response) => { cache.set(String(key), value) }, match: async (key: URL) => cache.get(String(key))?.clone() }) },
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
      registration: { scope: "https://app.test/ipfs/release/", showNotification }, clients: { openWindow, claim: async () => {} }, skipWaiting: async () => {} },
  })
  const fire = async (name: string, data: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve()
    handlers[name]!({ ...data, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
    await pending
  }
  return { fire, showNotification, fetch, openWindow }
}

describe("alerts service worker", () => {
  it("shows the notification before acknowledging receipt and preserves an IPFS deployment scope", async () => {
    const sw = worker()
    await sw.fire("message", { data: { type: "alerts-config", api: "https://alerts.test" } })
    await sw.fire("push", { data: { json: () => ({ body: "Cooldown ready", ack: "receipt" }) } })
    expect(sw.showNotification).toHaveBeenCalledWith("Safenet", expect.objectContaining({ body: "Cooldown ready" }))
    expect(sw.showNotification.mock.invocationCallOrder[0]).toBeLessThan(sw.fetch.mock.invocationCallOrder[0]!)
    expect(sw.fetch).toHaveBeenCalledWith("https://alerts.test/delivery/ack", expect.objectContaining({ body: JSON.stringify({ ack: "receipt" }) }))
    await sw.fire("notificationclick", { notification: { close: vi.fn() } })
    expect(sw.openWindow).toHaveBeenCalledWith("https://app.test/ipfs/release/#/alerts")
  })
  it("never acknowledges a notification the browser refused to show", async () => {
    const sw = worker()
    await sw.fire("message", { data: { type: "alerts-config", api: "https://alerts.test" } })
    sw.showNotification.mockRejectedValueOnce(new Error("permission revoked"))
    await expect(sw.fire("push", { data: { json: () => ({ body: "ready", ack: "receipt" }) } })).rejects.toThrow("permission revoked")
    expect(sw.fetch).not.toHaveBeenCalled()
  })
})
