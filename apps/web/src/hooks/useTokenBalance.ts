import { useReadContract, useAccount } from "wagmi"
import { erc20Abi } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"

/** `refetchInterval` polls while a caller needs a balance that is about to change, such as after a claim. */
export function useTokenBalance({ refetchInterval }: { refetchInterval?: number } = {}) {
  const { address } = useAccount()
  const { token } = getContractAddresses(activeChain.id)

  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address, refetchInterval },
  })
}
