import { unstakingPeriodText } from "@/lib/glossary"
import { useTranslation } from "react-i18next"
import { useState, useEffect, useCallback } from "react"
import { type Address } from "viem"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { TxButton } from "@/components/ui/TxButton"
import { AmountInput } from "./AmountInput"
import { useUserStakeOnValidator, useWithdrawDelay } from "@/hooks/useStakingReads"
import { useInitiateWithdrawal } from "@/hooks/useStakingWrites"
import { useTxToast } from "@/hooks/useTxToast"
import { truncateAddress, safeParseEther } from "@/lib/format"
import { useGasEstimate } from "@/hooks/useGasEstimate"
import { Term } from "@/components/ui/term"
import Fuel from "lucide-react/dist/esm/icons/fuel"

interface UndelegateDialogProps {
  validator: Address
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UndelegateDialog({ validator, open, onOpenChange }: UndelegateDialogProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState("")
  const { data: userStake } = useUserStakeOnValidator(validator)
  const { initiateWithdrawal, isSigningTx, isConfirmingTx, isSuccess, isSafeQueued, error, reset, txHash } = useInitiateWithdrawal()
  const { data: withdrawDelay } = useWithdrawDelay()

  const parsedAmount = safeParseEther(amount)
  const userStakeValue = typeof userStake === "bigint" ? userStake : undefined
  const canUndelegate = parsedAmount > 0n && userStakeValue !== undefined && parsedAmount <= userStakeValue
  const { estimatedCost: gasEstimate } = useGasEstimate("initiateWithdrawal", validator, parsedAmount)

  const closeAndClearAmount = useCallback(() => {
    setAmount("")
    onOpenChange(false)
  }, [onOpenChange])

  useTxToast(
    {
      successTitle: t("staking.unstakingInitiated", "Unstaking initiated"),
      successDescription: t("staking.queuedWithdrawalOfSafeFrom", "Queued withdrawal of {{amount}} SAFE from {{address}}", { amount: amount, address: truncateAddress(validator) }),
      errorTitle: t("staking.unstakingFailed", "Unstaking failed"),
      safeQueuedDescription: t("staking.yourWithdrawalRequestHasBeenSentToSafe", "Your withdrawal request has been sent to Safe Wallet for signing."),
    },
    {
      isSuccess,
      error,
      isSafeQueued,
      txHash,
      reset,
      onSuccess: closeAndClearAmount,
    },
  )

  // Reset form state on close
  useEffect(() => {
    if (!open) {
      setAmount("")
      reset()
    }
  }, [open, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("staking.unstakeSafe", "Unstake SAFE")}</DialogTitle>
          <DialogDescription>{t("staking.initiateWithdrawalFromValidatorTokensEnterAWithdrawal", "Initiate withdrawal from validator {{address}}. Tokens enter a withdrawal queue with a time delay before they can be claimed.", { address: truncateAddress(validator) })}</DialogDescription>
        </DialogHeader>

        <AmountInput
          value={amount}
          onChange={setAmount}
          maxAmount={userStakeValue}
          label={t("staking.unstakeAmount", "Unstake Amount")}
        />

        {gasEstimate && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Fuel className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t("staking.estimatedGasEth", "Estimated gas: ~{{value}} ETH", { value: parseFloat(gasEstimate).toFixed(6) })}</span>
          </div>
        )}

        {withdrawDelay !== undefined && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span>
              <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay}>{t("onboarding.unstakingPeriod", "Unstaking period")}</Term>: {unstakingPeriodText(withdrawDelay)}. {t("onboarding.claimAfterPeriod", "Tokens will be claimable after this period.")}
            </span>
          </div>
        )}

        <TxButton
          isSigningTx={isSigningTx}
          isConfirmingTx={isConfirmingTx}
          onClick={() => initiateWithdrawal(validator, parsedAmount)}
          disabled={!canUndelegate}
        >{t("staking.initiateWithdrawal", "Initiate Withdrawal")}</TxButton>
      </DialogContent>
    </Dialog>
  )
}
