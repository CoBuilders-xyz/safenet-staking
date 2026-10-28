import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import AlertTriangle from "lucide-react/dist/esm/icons/triangle-alert"

/**
 * The page-level message of ErrorBoundary. ErrorBoundary is a class; this is a function
 * component so that it can read the current language.
 */
export function PageError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <AlertTriangle
        className="h-10 w-10 text-destructive"
        aria-hidden="true"
      />
      <h2 className="text-2xl font-bold">{t("shell.error.title", "Something went wrong")}</h2>
      <p className="text-muted-foreground">
        {t("shell.error.description", "An unexpected error occurred while loading this page.")}
      </p>
      <Button onClick={onRetry}>{t("shell.error.retry", "Try Again")}</Button>
    </div>
  )
}
