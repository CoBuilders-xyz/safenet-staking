import { describe, expect, it } from "vitest"
import { LANGUAGES, detectLanguage, isLanguage, matchLanguage } from "../languages"

describe("matchLanguage", () => {
  it.each([
    ["en-US", "en"],
    ["es-419", "es"],
    ["de-AT", "de"],
    ["fr-CA", "fr"],
    ["it", "it"],
    ["pt-BR", "pt"],
    ["pt-PT", "pt"],
    ["ru-RU", "ru"],
    ["zh", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans-HK", "zh-Hans"],
    ["ZH_cn", "zh-Hans"],
  ])("%s gets %s", (tag, language) => {
    expect(matchLanguage(tag)).toBe(language)
  })

  it.each(["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-TW", "ja", "nl-NL", ""])("%s gets no catalogue", (tag) => {
    expect(matchLanguage(tag)).toBeUndefined()
  })
})

describe("detectLanguage", () => {
  it("prefers the stored choice over the browser", () => {
    expect(detectLanguage("ru", ["de-DE", "en"])).toBe("ru")
  })

  it("ignores a stored value that is not a language", () => {
    expect(detectLanguage("klingon", ["de-DE"])).toBe("de")
  })

  it("takes the first preferred language that ships", () => {
    expect(detectLanguage(null, ["ja-JP", "zh-TW", "it-IT", "fr"])).toBe("it")
  })

  it("falls back to English", () => {
    expect(detectLanguage(null, ["ja-JP", "ko"])).toBe("en")
    expect(detectLanguage(null, [])).toBe("en")
  })
})

describe("LANGUAGES", () => {
  it("ships the eight languages of the proposal, English first", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(["en", "es", "de", "fr", "it", "pt", "ru", "zh-Hans"])
    expect(LANGUAGES.every((l) => isLanguage(l.code))).toBe(true)
  })
})
