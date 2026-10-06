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
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const form = useStakeForm({ validator, active: open, onStaked: close })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stake SAFE</DialogTitle>
          <DialogDescription>
            Stake tokens to validator {truncateAddress(validator)}
          </DialogDescription>
        </DialogHeader>

        <StakeForm form={form} />
      </DialogContent>
    </Dialog>
  )
}
