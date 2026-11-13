import { useTranslation } from "react-i18next"
import { SEF_DOCS } from "@cobuilders/safenet-core"
import { LegalLink } from "@/components/LegalLink"
import { OPERATOR_NAME, type ContentPageName } from "@/config/legal"

const docsUrl = import.meta.env.VITE_DOCS_URL || SEF_DOCS.home

const linkClass = "hover:text-foreground transition-colors"

export function Footer() {
  const { t } = useTranslation()
  const labels: Record<ContentPageName, string> = {
    terms: t("footer.terms", "Terms"),
    privacy: t("footer.privacy", "Privacy"),
    imprint: t("footer.imprint", "Imprint"),
    faq: t("footer.faq", "FAQ"),
  }
  const link = (page: ContentPageName) => <LegalLink page={page} className={linkClass}>{labels[page]}</LegalLink>
  return (
    <footer className="border-t border-border mt-auto">
      <div className="container mx-auto flex flex-col items-center gap-3 px-4 py-5 sm:flex-row sm:justify-between">
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <p className="flex items-baseline gap-2">
            <span className="font-heading text-sm font-semibold tracking-tight text-foreground">Safenet Staking</span>
            <span className="text-xs text-muted-foreground">{t("shell.byCoBuilders", "by CoBuilders")}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("footer.operatedBy", "Operated by {{operator}}", { operator: OPERATOR_NAME })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {link("terms")}
          {link("privacy")}
          {link("imprint")}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t("footer.documentation", "Documentation")}
          </a>
          {link("faq")}
        </div>
      </div>
    </footer>
  )
}
