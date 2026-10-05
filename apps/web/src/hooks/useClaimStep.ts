import { useCallback, useMemo, useState } from "react"
import {
  useAccount,
  useCallsStatus,
  usePublicClient,
  useSendCalls,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"
import { encodeFunctionData, type Hex } from "viem"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { isSafeApp } from "@/lib/safe"
import { claimedAmountFromLogs } from "@/lib/claimReceipt"
import { claimCall, REWARD_EXTRA_KEYS, REWARD_FN_NAMES } from "./useClaimRewards"
import { useAtomicBatchSupport, useInvalidateOnSuccess } from "./useStakingWrites"

const { merkleDrop, token } = getContractAddresses(activeChain.id)

export interface ClaimInput {
  cumulativeAmount: bigint
  merkleRoot: Hex
  proof: Hex[]
}

/**
 * The claim step of Claim & Stake: the same MerkleDrop call as `useClaimRewards`, plus what the
 * stake step needs, which is the confirmed receipt and the amount it paid out.
 *
 * Simulated first, so a revert such as `MerkleRootWasUpdated` is decoded before the user signs.
 *
 * A wallet that batches (a Safe) gets the claim through `wallet_sendCalls`, as a batch of one.
 * There `writeContract` returns a Safe transaction hash that never gets a receipt, while
 * `wallet_getCallsStatus` reports the hash of the transaction that executed it.
 */
export function useClaimStep() {
  const { address } = useAccount()
  const client = usePublicClient()
  const supportsBatching = useAtomicBatchSupport()

  const write = useWriteContract()
  const send = useSendCalls()
  const batchId = send.data?.id

  const { data: callsStatus } = useCallsStatus({
    id: batchId ?? "",
    query: {
      enabled: !!batchId,
      refetchInterval: (query) =>
        query.state.data?.status === "success" || query.state.data?.status === "failure" ? false : 2000,
    },
  })
  const executedHash = callsStatus?.status === "success" ? callsStatus.receipts?.[0]?.transactionHash : undefined
  const txHash = write.data ?? executedHash
  const receipt = useWaitForTransactionReceipt({ hash: txHash })

  const [isSimulating, setIsSimulating] = useState(false)
  const [preflightError, setPreflightError] = useState<Error | null>(null)

  const batchFailed = callsStatus?.status === "failure"
  const batchError = useMemo(
    () => (batchFailed ? new Error("The claim transaction reverted on chain.") : null),
    [batchFailed],
  )
  const error = preflightError ?? write.error ?? send.error ?? receipt.error ?? batchError

  const isSuccess = receipt.isSuccess
  useInvalidateOnSuccess(isSuccess, REWARD_FN_NAMES, REWARD_EXTRA_KEYS)

  const claimedAmount =
    isSuccess && address && merkleDrop
      ? claimedAmountFromLogs(receipt.data.logs, { token, merkleDrop, account: address })
      : undefined

  const isSigningTx = isSimulating || write.isPending || send.isPending
  const isConfirmingTx = !error && !isSuccess && (!!write.data || !!batchId)
  /** A batch the wallet accepted but has not executed: in a Safe, owners may still need to sign. */
  const isAwaitingExecution = !!batchId && !executedHash && !batchFailed
  /** A Safe App without batching: queued in the Safe, with no receipt this page can wait for. */
  const isSafeQueued = isSafeApp && write.isSuccess && !isSuccess

  const { mutate: writeContract, reset: resetWrite } = write
  const { mutate: sendCalls, reset: resetSend } = send

  const claim = useCallback(
    async ({ cumulativeAmount, merkleRoot, proof }: ClaimInput) => {
      if (!address || !client) return
      const call = claimCall(address, cumulativeAmount, merkleRoot, proof)
      if (!call) return

      setPreflightError(null)
      setIsSimulating(true)
      try {
        await client.simulateContract({ ...call, account: address })
      } catch (err) {
        setPreflightError(err instanceof Error ? err : new Error(String(err)))
        return
      } finally {
        setIsSimulating(false)
      }

      if (supportsBatching) {
        sendCalls({ calls: [{ to: call.address, data: encodeFunctionData(call) }] })
      } else {
        writeContract(call)
      }
    },
    [address, client, supportsBatching, sendCalls, writeContract],
  )

  const reset = useCallback(() => {
    resetWrite()
    resetSend()
    setPreflightError(null)
  }, [resetWrite, resetSend])

  return {
    claim,
    reset,
    supportsBatching,
    isSigningTx,
    isConfirmingTx,
    isAwaitingExecution,
    isSafeQueued,
    isSuccess,
    error,
    txHash,
    /** What the claim paid out, from its receipt. Undefined until confirmed, or if unreadable. */
    claimedAmount,
  }
}
