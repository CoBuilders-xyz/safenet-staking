import { useTranslation } from "react-i18next"
import { useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { TxButton } from "@/components/ui/TxButton"
import { useAccount } from "wagmi"
import { useRewardProof } from "@/hooks/useRewardProof"
import { useRewards } from "@/hooks/useRewards"
import { useClaimRewards } from "@/hooks/useClaimRewards"
import { useToast } from "@/hooks/useToast"
import { formatTokenAmount } from "@/lib/format"
import { formatContractError } from "@/lib/errorFormat"

interface ClaimRewardsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClaimRewardsDialog({ open, onOpenChange }: ClaimRewardsDialogProps) {
  const { t } = useTranslation()
  const { address } = useAccount()
  const { data: proof } = useRewardProof(address)
  const { data: rewards } = useRewards()
  const {
    claimRewards,
    isSigningTx,
    isConfirmingTx,
    isSuccess,
    error,
    reset,
    txHash,
  } = useClaimRewards()
  const { toast } = useToast()
  const claimedAmountRef = useRef(0n)

  useEffect(() => {
    if (isSuccess) {
      toast({
        variant: "success",
        title: t("dashboard.rewardsClaimed", "Rewards claimed"),
        description: t("dashboard.claimedSafe", "Claimed {{amount}} SAFE", { amount: formatTokenAmount(claimedAmountRef.current) }),
        txHash,
      })
      reset()
      onOpenChange(false)
    }
  }, [isSuccess, reset, onOpenChange, toast, txHash, t])

  useEffect(() => {
    if (error) {
      toast({
        variant: "error",
        title: t("dashboard.claimFailed", "Claim failed"),
        description: formatContractError(error),
      })
    }
  }, [error, t, toast])

  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open, reset])

  function handleClaim() {
    if (!address || !proof || !proof.proof) return
    claimedAmountRef.current = rewards.claimable
    claimRewards(
      address,
      BigInt(proof.cumulativeAmount),
      proof.merkleRoot,
      proof.proof,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dashboard.claimRewards", "Claim Rewards")}</DialogTitle>
          <DialogDescription>{t("dashboard.claimYourAccumulatedSafeStakingRewards", "Claim your accumulated SAFE staking rewards.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <span className="text-sm text-muted-foreground">{t("dashboard.claimableSafe", "Claimable SAFE")}</span>
            <span className="text-lg font-mono font-medium tabular-nums">
              {formatTokenAmount(rewards.claimable)}
            </span>
          </div>

          <TxButton
            className="w-full"
            isSigningTx={isSigningTx}
            isConfirmingTx={isConfirmingTx}
            onClick={handleClaim}
            disabled={!rewards.canClaim}
          >{t("dashboard.claimRewards", "Claim Rewards")}</TxButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
