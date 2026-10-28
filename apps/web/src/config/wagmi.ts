import { createConfig } from "wagmi"
import { injected, safe } from "wagmi/connectors"
import { activeChain, transports } from "./chains"
import { deferredWalletConnect } from "./walletConnect"

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

const connectors = [
  safe({ debug: false }),
  injected({
    target: {
      id: "browserWallet",
      name: "Browser Wallet",
      provider: () => window.ethereum,
    },
  }),
  ...(projectId && projectId.length > 0
    ? [deferredWalletConnect({ projectId })]
    : []),
]

export const config = createConfig({
  chains: [activeChain],
  connectors,
  transports,
})

declare module "wagmi" {
  interface Register {
    config: typeof config
  }
}
