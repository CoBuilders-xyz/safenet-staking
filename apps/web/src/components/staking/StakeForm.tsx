import { unstakingPeriodText } from "@/lib/glossary"
import { useTranslation } from "react-i18next"
import type { ReactNode } from "react"
import { TxButton } from "@/components/ui/TxButton"
import { Term } from "@/components/ui/term"
import { AmountInput } from "./AmountInput"
import { StakeReview } from "./StakeReview"
import type { StakeFormState } from "@/hooks/useStakeForm"
import { isRounded } from "@/lib/format"
import Fuel from "lucide-react/dist/esm/icons/fuel"

interface StakeFormProps {
  form: StakeFormState
  /** Label in front of the ceiling shown above the input. Defaults to the wallet balance's. */
  maxLabel?: string
  /** Shown when the amount is above `maxAmount`. */
  aboveMaxMessage?: string
  /** Extra lines under the amount, such as what stays in the wallet. */
  notes?: ReactNode
}

/** Amount, gas, unstaking period, and the approve and stake buttons. State comes from `useStakeForm`. */
export function StakeForm({ form, maxLabel, aboveMaxMessage, notes }: StakeFormProps) {
  const { t } = useTranslation()
  const {
    validator,
    amount,
    setAmount,
    setPresetAmount,
    preset,
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
    approval,
    stake,
    batch,
    reviewing,
    startReview,
  } = form
  const {
    needsApproval,
    approvalType,
    isApprovalPending,
    isSigningApproval,
    isConfirmingApproval,
    approveExact,
    approveUnlimited,
  } = approval

  const ceiling =
    maxAmount !== undefined && balanceValue !== undefined && balanceValue < maxAmount ? balanceValue : (maxAmount ?? balanceValue)

  // Stake opens the "what happens if" step; only its Confirm sends the transaction.
  if (reviewing) return <StakeReview form={form} />

  return (
    <>
      <AmountInput
        value={amount}
        onChange={setAmount}
        onPreset={setPresetAmount}
        maxAmount={ceiling}
        maxLabel={maxAmount !== undefined ? maxLabel : undefined}
        disabled={hasZeroBalance}
      />

      {preset && isRounded(preset) && (
        <p className="text-xs text-muted-foreground">
          {t("onboarding.shownRoundedDownToFourDecimalsTheStakeSends", "Shown rounded down to four decimals. The stake sends the whole amount, to the last wei.")}</p>
      )}

      {hasZeroBalance && (
        <p className="text-sm text-destructive">{t("staking.youDoNotHaveEnoughSafeToStake", "You do not have enough SAFE to stake.")}</p>
      )}

      {insufficientBalance && !hasZeroBalance && (
        <p className="text-sm text-destructive">{t("staking.youDoNotHaveEnoughSafeToStake2", "You do not have enough SAFE to stake this amount.")}</p>
      )}

      {aboveMax && !insufficientBalance && aboveMaxMessage && (
        <p className="text-sm text-destructive">{aboveMaxMessage}</p>
      )}

      {notes}

      {!isBatchFlow && gasEstimate && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Fuel className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("staking.estimatedGasEth", "Estimated gas: ~{{value}} ETH", { value: parseFloat(gasEstimate).toFixed(6) })}</span>
        </div>
      )}

      {withdrawDelay !== undefined && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <span>
            <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay}>{t("onboarding.unstakingPeriod", "Unstaking period")}</Term>: {unstakingPeriodText(withdrawDelay)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {isBatchFlow ? (
          <TxButton
            isSigningTx={batch.isSigningTx}
            isConfirmingTx={batch.isConfirmingTx}
            signingLabel={t("staking.confirmInSafe", "Confirm in Safe…")}
            onClick={startReview}
            disabled={!validator || parsedAmount === 0n || insufficientBalance || aboveMax}
          >{t("validators.stake", "Stake")}</TxButton>
        ) : needsApproval ? (
          <>
            {approvalType !== "unlimited" && (
              <TxButton
                isSigningTx={isSigningApproval && approvalType === "exact"}
                isConfirmingTx={isConfirmingApproval && approvalType === "exact"}
                signingLabel={t("staking.confirmApprovalInWallet", "Confirm Approval in Wallet…")}
                confirmingLabel={t("staking.approvalConfirming", "Approval confirming…")}
                onClick={approveExact}
                disabled={isApprovalPending || parsedAmount === 0n || aboveMax}
              >{t("staking.approveExactAmount", "Approve exact amount")}</TxButton>
            )}
            {approvalType !== "exact" && (
              <TxButton
                variant="outline"
                isSigningTx={isSigningApproval && approvalType === "unlimited"}
                isConfirmingTx={isConfirmingApproval && approvalType === "unlimited"}
                signingLabel={t("staking.confirmApprovalInWallet", "Confirm Approval in Wallet…")}
                confirmingLabel={t("staking.approvalConfirming", "Approval confirming…")}
                onClick={approveUnlimited}
                disabled={isApprovalPending || parsedAmount === 0n || aboveMax}
              >{t("staking.approveUnlimited", "Approve unlimited")}</TxButton>
            )}
          </>
        ) : (
          <TxButton
            isSigningTx={stake.isSigningTx}
            isConfirmingTx={stake.isConfirmingTx}
            onClick={startReview}
            disabled={!canDelegate}
          >{t("validators.stake", "Stake")}</TxButton>
        )}
      </div>
    </>
  )
}
