import { useAccount, useReadContract } from "wagmi"
import { merkleDropAbi } from "@/abi/merkleDropAbi"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { useRewardProof } from "./useRewardProof"
import { sameRoot } from "./useProgrammeRewards"

const { merkleDrop } = getContractAddresses(activeChain.id)

export interface RewardsData {
  claimable: bigint
  totalClaimed: bigint
  canClaim: boolean
  rootStale: boolean
}

const EMPTY: RewardsData = { claimable: 0n, totalClaimed: 0n, canClaim: false, rootStale: false }

export function useRewards() {
  const { address } = useAccount()

  const {
    data: proof,
    isLoading: isProofLoading,
    error: proofError,
    refetch: refetchProof,
  } = useRewardProof(address, !!merkleDrop)

  const hasProof = !!proof

  const {
    data: cumulativeClaimed,
    isLoading: isClaimedLoading,
    error: claimedError,
    refetch: refetchClaimed,
  } = useReadContract({
    address: merkleDrop,
    abi: merkleDropAbi,
    functionName: "cumulativeClaimed",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!merkleDrop && hasProof,
      refetchInterval: 15_000,
    },
  })

  const { data: onChainRoot, refetch: refetchRoot } = useReadContract({
    address: merkleDrop,
    abi: merkleDropAbi,
    functionName: "merkleRoot",
    query: {
      enabled: !!merkleDrop && hasProof,
      staleTime: 60_000,
    },
  })

  const isLoading = isProofLoading || isClaimedLoading
  // The proof comes from SEF's published file, the claimed amount from the chain.
  // Either failing leaves the numbers unknown, so callers get one error to show.
  const error = proofError ?? claimedError ?? null
  const refetch = () => {
    void refetchProof()
    if (hasProof) void refetchClaimed()
  }
  /**
   * Fetches the proof and the on-chain root again, and returns both. For a claim that reverted
   * because the root moved: the caller needs the fresh pair at once, not on the next render.
   */
  const reload = async () => {
    const [fresh, root] = await Promise.all([refetchProof(), refetchRoot()])
    if (hasProof) void refetchClaimed()
    // refetch() resolves on failure too, with the error on the result. Pass it on.
    return { proof: fresh.data, root: root.data, error: fresh.error ?? root.error ?? null }
  }
  // `null` means SEF published no file for this address: it never earned rewards.
  const meta = { isLoading, error, refetch, reload, proof, hasMerkleDrop: !!merkleDrop }

  if (!proof || cumulativeClaimed === undefined) {
    return { data: EMPTY, ...meta }
  }

  const cumulativeAmount = BigInt(proof.cumulativeAmount)
  const claimable = cumulativeAmount > cumulativeClaimed ? cumulativeAmount - cumulativeClaimed : 0n
  // viem decodes bytes32 in lower case; the proof file may not be.
  const rootStale = sameRoot(onChainRoot, proof.merkleRoot) === false

  return {
    data: {
      claimable,
      totalClaimed: cumulativeClaimed,
      canClaim: claimable > 0n && !rootStale,
      rootStale,
    },
    ...meta,
  }
}
