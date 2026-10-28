import { describe, it, expect, vi, beforeEach } from "vitest"

const inner = vi.hoisted(() => ({
  id: "walletConnect",
  setup: vi.fn(async () => {}),
  connect: vi.fn(async () => ({ accounts: [], chainId: 1 })),
  getProvider: vi.fn(async () => ({ provider: true })),
  isAuthorized: vi.fn(async () => true),
}))

vi.mock("wagmi/connectors", () => ({ walletConnect: () => () => inner }))

const { deferredWalletConnect } = await import("../walletConnect")

function connectorWith(recent: string | null) {
  const storage = { getItem: vi.fn(async () => recent) }
  const create = deferredWalletConnect({ projectId: "test" }) as unknown as (config: unknown) => typeof inner
  return create({ chains: [], emitter: {}, storage })
}

describe("deferredWalletConnect", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads nothing for a visitor who did not use WalletConnect last", async () => {
    const connector = connectorWith("injected")

    await connector.setup()
    expect(await connector.getProvider()).toBeUndefined()
    expect(await connector.isAuthorized()).toBe(false)
    expect(inner.setup).not.toHaveBeenCalled()
    expect(inner.getProvider).not.toHaveBeenCalled()
    expect(inner.isAuthorized).not.toHaveBeenCalled()
  })

  it("restores a session when WalletConnect was the last connector used", async () => {
    const connector = connectorWith("walletConnect")

    await connector.setup()
    expect(await connector.getProvider()).toEqual({ provider: true })
    expect(await connector.isAuthorized()).toBe(true)
    expect(inner.setup).toHaveBeenCalledOnce()
  })

  it("loads the provider once the user picks WalletConnect", async () => {
    const connector = connectorWith(null)
    expect(await connector.getProvider()).toBeUndefined()

    await connector.connect()
    expect(inner.connect).toHaveBeenCalledOnce()
    expect(await connector.getProvider()).toEqual({ provider: true })
  })
})
