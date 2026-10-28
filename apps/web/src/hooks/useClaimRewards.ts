import { useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { merkleDropAbi } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { useInvalidateOnSuccess } from "./useStakingWrites"
import { getAddress } from "viem"
import type { Address, Hex } from "viem"

const { merkleDrop } = getContractAddresses(activeChain.id)

/** Contract function names to invalidate after claiming rewards. */
export const REWARD_FN_NAMES = ["cumulativeClaimed", "balanceOf"]
export const REWARD_EXTRA_KEYS = [["rewardProof"]]

/**
 * The MerkleDrop claim, as both the plain Claim and Claim & Stake send it.
 * Undefined when this network has no MerkleDrop.
 */
export function claimCall(
  account: Address,
  cumulativeAmount: bigint,
  expectedMerkleRoot: Hex,
  merkleProof: Hex[],
) {
  if (!merkleDrop) return undefined
  return {
    address: merkleDrop,
    abi: merkleDropAbi,
    functionName: "claim",
    args: [getAddress(account), cumulativeAmount, expectedMerkleRoot, merkleProof],
  } as const
}

export function useClaimRewards() {
  const { writeContract, data: txHash, isPending, reset, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash })
  const error = writeError ?? receiptError

  useInvalidateOnSuccess(isSuccess, REWARD_FN_NAMES, REWARD_EXTRA_KEYS)

  function claimRewards(
    account: Address,
    cumulativeAmount: bigint,
    expectedMerkleRoot: Hex,
    merkleProof: Hex[],
  ) {
    const call = claimCall(account, cumulativeAmount, expectedMerkleRoot, merkleProof)
    if (!call) return
    writeContract(call)
  }

  return {
    claimRewards,
    isSigningTx: isPending,
    isConfirmingTx: isConfirming,
    isSuccess,
    error,
    reset,
    txHash,
  }
}
