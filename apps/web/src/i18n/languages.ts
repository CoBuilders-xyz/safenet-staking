/**
 * The languages the interface ships in. `code` names the catalogue, `locales/<code>.json`, and
 * becomes the document's `lang` attribute. `name` is the language's own name: the switcher shows
 * every name in its own language, so a reader finds theirs without reading the current one.
 *
 * No DOM and no i18next here: the extraction tool imports this file under Node.
 */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "zh-Hans", name: "简体中文" },
] as const

export type Language = (typeof LANGUAGES)[number]["code"]

/** The language the source is written in. Its catalogue is in the main bundle; every other loads on demand. */
export const SOURCE_LANGUAGE: Language = "en"

/** Where `localStorage` keeps a language the reader chose. A detected language is never stored. */
export const LANGUAGE_STORAGE_KEY = "language"

export function isLanguage(value: string): value is Language {
  return LANGUAGES.some((l) => l.code === value)
}

/** Regions whose readers use Traditional characters when the tag names no script. */
const TRADITIONAL_REGIONS = new Set(["tw", "hk", "mo"])

/**
 * The catalogue for one BCP 47 tag from the browser, or undefined. `de-AT` gets German, `pt-BR`
 * Portuguese. Only Simplified Chinese ships, so `zh`, `zh-CN`, `zh-SG` and any `zh-Hans` tag get
 * it, and `zh-TW`, `zh-HK`, `zh-MO` and any `zh-Hant` tag do not: those readers get their next
 * preferred language, then English, rather than a script they did not ask for.
 */
export function matchLanguage(tag: string): Language | undefined {
  const parts = tag.toLowerCase().split(/[-_]/)
  const base = parts[0]
  if (base === "zh") {
    if (parts.includes("hans")) return "zh-Hans"
    if (parts.includes("hant") || parts.some((p) => TRADITIONAL_REGIONS.has(p))) return undefined
    return "zh-Hans"
  }
  return LANGUAGES.find((l) => l.code === base)?.code
}

/**
 * The language to start in: the reader's stored choice, else the first of the browser's
 * preferred languages that ships, else English.
 */
export function detectLanguage(stored: string | null, preferred: readonly string[]): Language {
  if (stored !== null && isLanguage(stored)) return stored
  for (const tag of preferred) {
    const match = matchLanguage(tag)
    if (match) return match
  }
  return SOURCE_LANGUAGE
}
