import { useReadContract, useAccount, useReadContracts } from "wagmi"
import { stakingAbi } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import type { Address } from "viem"

const addresses = getContractAddresses(activeChain.id)

const POLL_INTERVAL = 30_000

/** Pass `enabled: false` to hold the read, for a screen that reads it only as a fallback. */
export function useTotalStaked({ enabled = true }: { enabled?: boolean } = {}) {
  return useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "totalStakedAmount",
    query: { enabled, refetchInterval: POLL_INTERVAL },
  })
}

export function useWithdrawDelay() {
  return useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "withdrawDelay",
  })
}

export function useUserTotalStake() {
  const { address } = useAccount()
  return useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "totalStakerStakes",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: POLL_INTERVAL },
  })
}

export function useUserStakeOnValidator(validator: Address) {
  const { address } = useAccount()
  return useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "stakes",
    args: address ? [address, validator] : undefined,
    query: { enabled: !!address, refetchInterval: POLL_INTERVAL },
  })
}

export function useValidatorTotalStake(validator: Address) {
  return useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "totalValidatorStakes",
    args: [validator],
    query: { refetchInterval: POLL_INTERVAL },
  })
}

export function useUserStakesOnValidators(validators: Address[]) {
  const { address } = useAccount()
  return useReadContracts({
    contracts: validators.map((v) => ({
      address: addresses.staking,
      abi: stakingAbi,
      functionName: "stakes" as const,
      args: address ? [address, v] as const : undefined,
    })),
    query: { enabled: !!address && validators.length > 0, refetchInterval: POLL_INTERVAL },
  })
}

export function useValidatorTotalStakes(validators: Address[], { enabled = true }: { enabled?: boolean } = {}) {
  return useReadContracts({
    contracts: validators.map((v) => ({
      address: addresses.staking,
      abi: stakingAbi,
      functionName: "totalValidatorStakes" as const,
      args: [v],
    })),
    query: { enabled: enabled && validators.length > 0, refetchInterval: POLL_INTERVAL },
  })
}
