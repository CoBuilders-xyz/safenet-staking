import { useAccount, useReadContract } from "wagmi"
import { sanctionsOracleAbi } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import type { Restriction } from "@/lib/restriction"

const { sanctionsOracle } = getContractAddresses(activeChain.id)

interface WalletSanctionsResult {
  allowed: boolean
  isLoading: boolean
  /** Why the gate is closed. Undefined while it is open or loading. */
  restriction?: Restriction
  /** Reads the oracle again, for a gate closed because the read failed. */
  refetch: () => void
}

export function useWalletSanctionsCheck(): WalletSanctionsResult {
  const { address } = useAccount()

  const { data: isSanctioned, isLoading, refetch: refetchOracle } = useReadContract({
    address: sanctionsOracle,
    abi: sanctionsOracleAbi,
    functionName: "isSanctioned",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!sanctionsOracle,
      staleTime: 60_000,
    },
  })

  const refetch = () => void refetchOracle()

  // No oracle on this chain or wallet not connected → allow
  if (!sanctionsOracle || !address) {
    return { allowed: true, isLoading: false, refetch }
  }

  // Fail-closed: only allow when oracle explicitly returns false
  if (isSanctioned === false) return { allowed: true, isLoading, refetch }
  if (isLoading) return { allowed: false, isLoading, refetch }
  return {
    allowed: false,
    isLoading,
    // Anything but an explicit true is a read that did not answer, not a listing.
    restriction: { gate: "walletSanctions", reason: isSanctioned === true ? "flagged" : "unavailable" },
    refetch,
  }
}
