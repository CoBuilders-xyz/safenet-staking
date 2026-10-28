import { useAccount, useSwitchChain } from "wagmi"
import { activeChain } from "@/config/chains"
import { useWrongNetwork } from "@/hooks/useWrongNetwork"

/**
 * The wallet's network against the one the interface reads, and the switch where the wallet
 * offers one. Browser wallets and WalletConnect can switch; the Safe connector cannot, because a
 * Safe lives on one chain.
 */
export function useNetworkSwitch() {
  const { chainId, connector } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const { switchChain, isPending, error } = useSwitchChain()
  return {
    wrongNetwork,
    /** The chain id the wallet reports. Undefined without a wallet. */
    walletChainId: chainId,
    canSwitch: typeof connector?.switchChain === "function",
    switchToActive: () => switchChain({ chainId: activeChain.id }),
    isSwitching: isPending,
    switchError: error,
  }
}
