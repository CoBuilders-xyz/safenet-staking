import { walletConnect, type WalletConnectParameters } from "wagmi/connectors"

type WalletConnectFn = ReturnType<typeof walletConnect>
type WalletConnectConfig = Parameters<WalletConnectFn>[0]

/**
 * WalletConnect, loaded only when it is used.
 *
 * wagmi's connector loads and initialises the WalletConnect provider, about 300 KB of
 * JavaScript and a request to its relay, as soon as the config is created, and `reconnect()`
 * asks every connector for its provider. So every visitor paid for WalletConnect on first paint,
 * though few use it. This wrapper hands wagmi no provider until one of two things happens: the
 * user picks WalletConnect, or WalletConnect was the last connector used, which is when a
 * session may need restoring. From then on it is the connector wagmi ships, unchanged.
 */
export function deferredWalletConnect(parameters: WalletConnectParameters): WalletConnectFn {
  const create = walletConnect(parameters)
  const deferred = (config: WalletConnectConfig) => {
    const inner = create(config)
    let wanted = false

    async function inUse(): Promise<boolean> {
      if (wanted) return true
      try {
        wanted = (await config.storage?.getItem("recentConnectorId")) === inner.id
      } catch {
        // No storage: nothing to restore.
      }
      return wanted
    }

    return {
      ...inner,
      async setup() {
        if (await inUse()) await inner.setup?.call(this)
      },
      async connect(...args: Parameters<typeof inner.connect>) {
        wanted = true
        return inner.connect.call(this, ...args)
      },
      async getProvider(...args: Parameters<typeof inner.getProvider>) {
        // wagmi's reconnect() skips a connector that has no provider.
        if (!(await inUse())) return undefined as unknown as Awaited<ReturnType<typeof inner.getProvider>>
        return inner.getProvider.call(this, ...args)
      },
      async isAuthorized() {
        return (await inUse()) ? inner.isAuthorized.call(this) : false
      },
    } as ReturnType<WalletConnectFn>
  }
  return deferred as WalletConnectFn
}
