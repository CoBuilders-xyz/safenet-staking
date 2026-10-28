import { useTranslation } from "react-i18next"
import { useState, useEffect, useCallback, useRef } from "react"
import type { Address, Hex } from "viem"
import { useTokenBalance } from "@/hooks/useTokenBalance"
import { useApprovalFlow } from "@/hooks/useApprovalFlow"
import { useStake, useBatchStake } from "@/hooks/useStakingWrites"
import { useWithdrawDelay } from "@/hooks/useStakingReads"
import { useToast } from "@/hooks/useToast"
import { useTxToast } from "@/hooks/useTxToast"
import { useGasEstimate } from "@/hooks/useGasEstimate"
import { truncateAddress, safeParseEther, formatTokenAmountRaw } from "@/lib/format"

export interface Staked {
  amount: bigint
  validator: Address
  txHash?: Hex
}

interface UseStakeFormOptions {
  /** Undefined until the user picks one. Staking stays disabled until then. */
  validator: Address | undefined
  /** False while the surrounding dialog is closed. The form then resets, unless a transaction is in flight. */
  active: boolean
  /** Amount to start from, in wei. The user may change it. */
  initialAmount?: bigint
  /** Ceiling for the amount, below the wallet balance. Without it the balance is the only ceiling. */
  maxAmount?: bigint
  /** Called once the stake confirms, after the success toast. */
  onStaked?: (staked: Staked) => void
  /**
   * SAFE known to be in the wallet whatever the balance read says, such as what a confirmed claim
   * just paid. A read from a node that has not seen that block must not lock the form.
   */
  availableAtLeast?: bigint
  /** Poll the balance while the form is active, for a balance that is about to change. */
  pollBalance?: boolean
}

/**
 * State and transactions behind the stake form: amount, approval (exact or unlimited), the
 * stake itself, and the approve-and-stake batch in wallets that support it. DelegateDialog and
 * the stake step of Claim & Stake both run on it, and `StakeForm` renders it.
 *
 * It lives in the dialog rather than in the form, so that a transaction still confirming when
 * the dialog closes keeps its toast.
 */
export function useStakeForm({
  validator,
  active,
  initialAmount,
  maxAmount,
  onStaked,
  availableAtLeast,
  pollBalance,
}: UseStakeFormOptions) {
  const { t } = useTranslation()
  // Null until the user types: the amount then follows `initialAmount`.
  const [typedAmount, setTypedAmount] = useState<string | null>(null)
  const amount = typedAmount ?? (initialAmount !== undefined ? formatTokenAmountRaw(initialAmount, 18, 18) : "")
  const { data: balance } = useTokenBalance({ refetchInterval: pollBalance && active ? 4_000 : undefined })

  const parsedAmount = safeParseEther(amount)

  const approval = useApprovalFlow(parsedAmount)
  const { needsApproval, resetApprovalFlow } = approval

  const {
    stake,
    isSigningTx,
    isConfirmingTx,
    isSuccess: isStaked,
    isSafeQueued: isStakeSafeQueued,
    error: stakeError,
    reset: resetStake,
    txHash: stakeTxHash,
  } = useStake()
  const {
    batchApproveAndStake,
    supportsBatching,
    isSigningTx: isBatchSigning,
    isConfirmingTx: isBatchConfirming,
    isSuccess: isBatchSuccess,
    isReverted: isBatchReverted,
    error: batchError,
    reset: resetBatch,
    txHash: batchTxHash,
  } = useBatchStake()
  const { data: withdrawDelay } = useWithdrawDelay()
  const { toast } = useToast()

  const readBalance = typeof balance === "bigint" ? balance : undefined
  // The floor covers reads from before the claim only. A read that reaches it includes the claim,
  // and from then on the reads are the truth, including a lower one after spending elsewhere.
  const [caughtUpTo, setCaughtUpTo] = useState<bigint | undefined>()
  const floorActive = availableAtLeast !== undefined && caughtUpTo !== availableAtLeast
  if (floorActive && readBalance !== undefined && readBalance >= availableAtLeast) {
    setCaughtUpTo(availableAtLeast)
  }
  const balanceValue =
    floorActive && (readBalance === undefined || readBalance < availableAtLeast) ? availableAtLeast : readBalance
  const hasZeroBalance = balanceValue !== undefined && balanceValue === 0n
  const insufficientBalance = balanceValue !== undefined && parsedAmount > 0n && parsedAmount > balanceValue
  const aboveMax = maxAmount !== undefined && parsedAmount > maxAmount
  const canDelegate =
    validator !== undefined &&
    parsedAmount > 0n &&
    !needsApproval &&
    balanceValue !== undefined &&
    parsedAmount <= balanceValue &&
    !aboveMax
  const { estimatedCost: gasEstimate } = useGasEstimate("stake", validator, parsedAmount)

  const isBatchFlow = supportsBatching && needsApproval
  const isBusy =
    isSigningTx || isConfirmingTx || isBatchSigning || isBatchConfirming || approval.isApprovalPending

  // Read through a ref, so a new callback from the parent does not re-run the toast effects.
  const onStakedRef = useRef(onStaked)
  useEffect(() => {
    onStakedRef.current = onStaked
  })

  // What was sent, not what the input shows when it confirms: the input stays editable meanwhile,
  // and a dialog closed mid-stake resets it. The ref feeds `onStaked`, the state the toast text.
  const submitted = useRef<Omit<Staked, "txHash"> | undefined>(undefined)
  const [sent, setSent] = useState<Omit<Staked, "txHash"> | undefined>()
  const submitStake = useCallback(
    (to: Address, value: bigint) => {
      submitted.current = { amount: value, validator: to }
      setSent(submitted.current)
      stake(to, value)
    },
    [stake],
  )
  const submitBatch = useCallback(
    (to: Address, value: bigint) => {
      submitted.current = { amount: value, validator: to }
      setSent(submitted.current)
      batchApproveAndStake(to, value)
    },
    [batchApproveAndStake],
  )

  const finish = useCallback((txHash: Hex | undefined) => {
    if (submitted.current) onStakedRef.current?.({ ...submitted.current, txHash })
    submitted.current = undefined
  }, [])
  const onStakeConfirmed = useCallback(() => finish(stakeTxHash), [finish, stakeTxHash])
  const onBatchConfirmed = useCallback(() => finish(batchTxHash), [finish, batchTxHash])

  const sentAmount = sent ? formatTokenAmountRaw(sent.amount, 18, 18) : amount
  const target = sent ? truncateAddress(sent.validator) : validator ? truncateAddress(validator) : t("staking.aValidator", "a validator")

  // Stake transaction toasts
  useTxToast(
    {
      successTitle: t("staking.delegationSuccessful", "Delegation successful"),
      successDescription: t("staking.stakedSafeTo", "Staked {{sentAmount}} SAFE to {{target}}", { sentAmount: sentAmount, target: target }),
      errorTitle: t("staking.delegationFailed", "Delegation failed"),
      safeQueuedDescription: t("staking.yourDelegationHasBeenSentToSafeWallet", "Your delegation has been sent to Safe Wallet for signing."),
    },
    {
      isSuccess: isStaked,
      error: stakeError,
      isSafeQueued: isStakeSafeQueued,
      txHash: stakeTxHash,
      reset: resetStake,
      onSuccess: onStakeConfirmed,
    },
  )

  // Batch transaction toasts
  useTxToast(
    {
      successTitle: t("staking.delegationSuccessful", "Delegation successful"),
      successDescription: t("staking.approvedAndStakedSafeTo", "Approved and staked {{sentAmount}} SAFE to {{target}}", { sentAmount: sentAmount, target: target }),
      errorTitle: t("staking.delegationFailed", "Delegation failed"),
    },
    {
      isSuccess: isBatchSuccess,
      error: batchError,
      isSafeQueued: false,
      txHash: batchTxHash,
      reset: resetBatch,
      onSuccess: onBatchConfirmed,
    },
  )

  useEffect(() => {
    if (isBatchReverted) {
      toast({ variant: "error", title: t("staking.transactionReverted", "Transaction reverted"), description: t("staking.theBatchTransactionWasRevertedOnchain", "The batch transaction was reverted onchain") })
      resetBatch()
    }
  }, [isBatchReverted, resetBatch, t, toast])

  // Resetting a transaction in flight would drop its receipt, and with it the toast and the
  // refreshed balances. So a dialog closed mid-transaction resets once the transaction settles.
  useEffect(() => {
    if (!active && !isBusy) {
      setTypedAmount(null)
      resetApprovalFlow()
      resetStake()
      resetBatch()
    }
  }, [active, isBusy, resetApprovalFlow, resetStake, resetBatch])

  return {
    validator,
    amount,
    setAmount: setTypedAmount,
    parsedAmount,
    balanceValue,
    maxAmount,
    hasZeroBalance,
    insufficientBalance,
    aboveMax,
    canDelegate,
    gasEstimate,
    withdrawDelay,
    isBatchFlow,
    isBusy,
    approval,
    stake: { stake: submitStake, isSigningTx, isConfirmingTx },
    batch: { batchApproveAndStake: submitBatch, isSigningTx: isBatchSigning, isConfirmingTx: isBatchConfirming },
  }
}

export type StakeFormState = ReturnType<typeof useStakeForm>
