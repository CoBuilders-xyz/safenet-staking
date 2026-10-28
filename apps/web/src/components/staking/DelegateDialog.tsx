import { useTranslation } from "react-i18next"
import { useCallback } from "react"
import { type Address } from "viem"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { StakeForm } from "./StakeForm"
import { useStakeForm } from "@/hooks/useStakeForm"
import { truncateAddress } from "@/lib/format"

interface DelegateDialogProps {
  validator: Address
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DelegateDialog({ validator, open, onOpenChange }: DelegateDialogProps) {
  const { t } = useTranslation()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const form = useStakeForm({ validator, active: open, onStaked: close })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("staking.stakeSafe", "Stake SAFE")}</DialogTitle>
          <DialogDescription>{t("staking.stakeTokensToValidator", "Stake tokens to validator {{address}}", { address: truncateAddress(validator) })}</DialogDescription>
        </DialogHeader>

        <StakeForm form={form} />
      </DialogContent>
    </Dialog>
  )
}
