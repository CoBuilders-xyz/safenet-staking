import i18n, { type BackendModule } from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import { LANGUAGES, LANGUAGE_STORAGE_KEY, SOURCE_LANGUAGE, detectLanguage, type Language } from "./languages"

/**
 * Every catalogue but English. Vite emits each as its own file in the build, so a reader fetches
 * only the one they choose, from the same origin as the app: an IPFS gateway serves it like any
 * other asset.
 */
const catalogues = import.meta.glob<Record<string, unknown>>(["./locales/*.json", "!./locales/en.json"], {
  import: "default",
})

const lazyCatalogues: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const load = catalogues[`./locales/${language}.json`]
    if (!load) {
      callback(null, {})
      return
    }
    load().then(
      (catalogue) => callback(null, catalogue),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false),
    )
  },
}

/** The stored choice, or null. Storage can be unavailable, as in a sandboxed iframe. */
function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Storage unavailable: the choice lasts until the page closes.
  }
}

/**
 * The language whose catalogue the page is showing. It is English when the chosen catalogue
 * failed to load, so the `lang` attribute and the switcher never claim a language the text is not in.
 */
export function currentLanguage(): Language {
  const resolved = i18n.resolvedLanguage
  return LANGUAGES.find((l) => l.code === resolved)?.code ?? SOURCE_LANGUAGE
}

/** The language a visit starts in: the stored choice, else the browser's, else English. */
export function startingLanguage(): Language {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  return detectLanguage(readStoredLanguage(), preferred)
}

function followLanguage(): void {
  document.documentElement.lang = currentLanguage()
}

/**
 * Starts i18next in the stored or detected language and resolves once its catalogue is loaded,
 * so the first render is already in that language. A catalogue that fails to load leaves the
 * page in English. Safe to call twice.
 */
export function initI18n(): Promise<unknown> {
  if (i18n.isInitialized) return Promise.resolve()
  i18n.on("languageChanged", followLanguage)
  return i18n
    .use(lazyCatalogues)
    .use(initReactI18next)
    .init({
      lng: startingLanguage(),
      fallbackLng: SOURCE_LANGUAGE,
      supportedLngs: LANGUAGES.map((l) => l.code),
      load: "currentOnly",
      resources: { [SOURCE_LANGUAGE]: { translation: en } },
      partialBundledLanguages: true,
      // React escapes what it renders; escaping here as well would show entities.
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
}

/** The switcher's action: show the page in `language` and remember the choice. */
export function chooseLanguage(language: Language): Promise<unknown> {
  storeLanguage(language)
  return i18n.changeLanguage(language)
}

export { i18n }
