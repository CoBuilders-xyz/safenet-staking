import { createConfig } from "wagmi"
import { injected, safe } from "wagmi/connectors"
import { activeChain, transports } from "./chains"
import { deferredWalletConnect } from "./walletConnect"
import { SAFE_INFO_TIMEOUT_MS } from "@/lib/safe"

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

const connectors = [
  safe({ debug: false, unstable_getInfoTimeout: SAFE_INFO_TIMEOUT_MS }),
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
