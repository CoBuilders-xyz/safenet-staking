import { useTranslation } from "react-i18next"
import { chooseLanguage, currentLanguage } from "@/i18n"
import { LANGUAGES, isLanguage } from "@/i18n/languages"
import LanguagesIcon from "lucide-react/dist/esm/icons/languages"

/**
 * The language menu in the header: an icon and the current language's code, with a native select
 * laid over them. The select works with a keyboard, a screen reader and a phone's picker with no
 * extra code, and the closed control stays narrow in every language. Each option is the
 * language's own name, marked with its `lang` so a screen reader pronounces it in that language.
 */
export function LanguageSwitcher() {
  const { t } = useTranslation()
  const current = currentLanguage()
  return (
    <div className="relative inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
      <LanguagesIcon className="h-4 w-4" aria-hidden="true" />
      <span aria-hidden="true">{current.split("-")[0].toUpperCase()}</span>
      <select
        aria-label={t("header.language", "Language")}
        value={current}
        onChange={(e) => {
          if (isLanguage(e.target.value)) void chooseLanguage(e.target.value)
        }}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  )
}
