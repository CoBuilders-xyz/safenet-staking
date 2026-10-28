import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-muted-foreground">{t("common.pageNotFound", "Page not found")}</p>
      <Button asChild>
        <Link to="/">{t("common.backToOverview", "Back to Overview")}</Link>
      </Button>
    </div>
  )
}
