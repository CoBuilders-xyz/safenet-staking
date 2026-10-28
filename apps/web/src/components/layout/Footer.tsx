import { useTranslation } from "react-i18next"
import { SEF_DOCS } from "@cobuilders/safenet-core"

const docsUrl = import.meta.env.VITE_DOCS_URL || SEF_DOCS.home
const termsUrl = import.meta.env.VITE_TERMS_URL as string | undefined
const privacyUrl = import.meta.env.VITE_PRIVACY_URL as string | undefined
const imprintUrl = import.meta.env.VITE_IMPRINT_URL as string | undefined

const linkClass = "hover:text-foreground transition-colors"

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-border mt-auto">
      <div className="container mx-auto flex flex-col items-center gap-3 px-4 py-5 sm:flex-row sm:justify-between">
        <p className="flex items-baseline gap-2">
          <span className="font-heading text-sm font-semibold tracking-tight text-foreground">Safenet Staking</span>
          <span className="text-xs text-muted-foreground">{t("shell.byCoBuilders", "by CoBuilders")}</span>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {termsUrl && (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t("footer.terms", "Terms")}
            </a>
          )}
          {privacyUrl && (
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t("footer.privacy", "Privacy")}
            </a>
          )}
          {imprintUrl && (
            <a href={imprintUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t("footer.imprint", "Imprint")}
            </a>
          )}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t("footer.documentation", "Documentation")}
          </a>
          <a href={SEF_DOCS.faq} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {t("footer.faq", "FAQ")}</a>
        </div>
      </div>
    </footer>
  )
}
