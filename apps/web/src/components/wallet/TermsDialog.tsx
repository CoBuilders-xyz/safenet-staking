import { Trans, useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LegalLink } from "@/components/LegalLink"

interface TermsDialogProps {
  open: boolean
  /** The visitor agreed. The caller records it and goes on to connect. */
  onAccept: () => void
  /** Closed without agreeing: nothing is recorded and no wallet connects. */
  onCancel: () => void
}

const linkClass = "underline underline-offset-2 text-foreground hover:text-primary transition-colors"

/** Asks for agreement to the Terms of use and the Privacy policy before a wallet connects. */
export default function TermsDialog({ open, onAccept, onCancel }: TermsDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.terms.title", "Before you connect")}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="wallet.terms.body"
              defaults="By connecting, you agree to the <terms>Terms of use</terms> and the <privacy>Privacy policy</privacy>."
              components={{
                terms: <LegalLink page="terms" newTab className={linkClass} />,
                privacy: <LegalLink page="privacy" newTab className={linkClass} />,
              }}
            />
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>{t("wallet.terms.cancel", "Cancel")}</Button>
          <Button onClick={onAccept}>{t("wallet.terms.agree", "Agree and connect")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
