import { describe, expect, it } from "vitest"
import {
  checkEnglish,
  checkTranslation,
  extractUsages,
  flatten,
  nest,
  pluralForms,
  sourceCatalogue,
} from "../i18n-catalogues"

const header = `import { useTranslation, Trans } from "react-i18next"\n`

function englishOf(source: string) {
  const { usages, errors } = extractUsages("src/x.tsx", header + source)
  expect(errors).toEqual([])
  return sourceCatalogue(usages)
}

describe("extractUsages and sourceCatalogue", () => {
  it("reads a key with its English, a plural key and a Trans", () => {
    const { catalogue, plural } = englishOf(`
      t("a.title", "Title")
      t("a.days", "{{count}} days", { count })
      t("a.items", { count: n, defaultValue_one: "one item", defaultValue_other: "{{count}} items" })
      const x = <Trans i18nKey="a.live" defaults="live <b>{{n}}</b>" values={{ n }} components={{ b: <b /> }} />
    `)
    expect(catalogue).toEqual({
      "a.title": "Title",
      "a.days_one": "{{count}} days",
      "a.days_other": "{{count}} days",
      "a.items_one": "one item",
      "a.items_other": "{{count}} items",
      "a.live": "live <b>{{n}}</b>",
    })
    expect([...plural].sort()).toEqual(["a.days", "a.items"])
  })

  it("rejects a key that is not a string literal", () => {
    const { errors } = extractUsages("src/x.tsx", header + "t(key)\nt(`a.${b}`, 'x')")
    expect(errors).toEqual(["src/x.tsx:2: the key must be a string literal", "src/x.tsx:3: the key must be a string literal"])
  })

  it("rejects English that is not a string literal", () => {
    const { errors } = extractUsages("src/x.tsx", header + "t('a', text)\nt('b', { defaultValue: text })")
    expect(errors).toHaveLength(2)
  })

  it("does not read a file that imports nothing from i18next", () => {
    expect(extractUsages("src/x.ts", "const t = (x: number) => x\nt(1)")).toEqual({ usages: [], errors: [] })
  })

  it("fails a key with no English, and one key with two different texts", () => {
    const { usages } = extractUsages("src/x.tsx", header + "t('a')\nt('b', 'One')\nt('b', 'Two')")
    expect(sourceCatalogue(usages).errors).toEqual([
      '"a" has no English text: src/x.tsx:2',
      '"b" has different English at src/x.tsx:3 and src/x.tsx:4',
    ])
  })

  it("accepts a key used twice with the same English, or once with it and once without", () => {
    const { catalogue, errors } = sourceCatalogue(extractUsages("src/x.tsx", header + "t('b', 'One')\nt('b', 'One')\nt('b')").usages)
    expect(errors).toEqual([])
    expect(catalogue).toEqual({ b: "One" })
  })
})

describe("checkTranslation", () => {
  const { catalogue: english, plural } = englishOf(`
    t("a.title", "Title")
    t("a.rule", "Below {{threshold}}%")
    t("a.days", "{{count}} days", { count })
    t("a.live", "live <b>{{n}}</b>", {})
  `)
  const german = {
    "a.title": "Titel",
    "a.rule": "Unter {{threshold}}%",
    "a.days_one": "{{count}} Tag",
    "a.days_other": "{{count}} Tage",
    "a.live": "aktiv <b>{{n}}</b>",
  }

  it("passes a complete catalogue", () => {
    expect(checkTranslation("de", german, english, plural)).toEqual([])
  })

  it("fails on one missing key", () => {
    const missing = Object.fromEntries(Object.entries(german).filter(([key]) => key !== "a.title"))
    expect(checkTranslation("de", missing, english, plural)).toEqual(['de: missing "a.title"'])
  })

  it("fails on one key the source does not use", () => {
    expect(checkTranslation("de", { ...german, "a.gone": "Weg" }, english, plural)).toEqual([
      'de: "a.gone" is not used in the source',
    ])
  })

  it("fails on a changed or dropped placeholder, and on a changed tag", () => {
    expect(checkTranslation("de", { ...german, "a.rule": "Unter {{schwelle}}%" }, english, plural)).toEqual([
      'de: "a.rule" has placeholders {schwelle}, English has {threshold}',
    ])
    expect(checkTranslation("de", { ...german, "a.live": "aktiv {{n}}" }, english, plural)).toEqual([
      'de: "a.live" has tags "", English has "</b> <b>"',
    ])
  })

  it("fails on an empty text", () => {
    expect(checkTranslation("de", { ...german, "a.title": " " }, english, plural)).toEqual(['de: "a.title" is empty'])
  })

  it("asks each language for its own plural forms", () => {
    expect(pluralForms("ru")).toEqual(["one", "few", "many", "other"])
    expect(pluralForms("zh-Hans")).toEqual(["other"])
    const russian = { "a.title": "Заголовок", "a.rule": "Ниже {{threshold}}%", "a.live": "<b>{{n}}</b>", "a.days_one": "{{count}} день", "a.days_other": "{{count}} дня" }
    expect(checkTranslation("ru", russian, english, plural)).toEqual(['ru: missing "a.days_few"', 'ru: missing "a.days_many"'])
    const chinese = { "a.title": "标题", "a.rule": "低于 {{threshold}}%", "a.live": "<b>{{n}}</b>", "a.days_other": "{{count}} 天" }
    expect(checkTranslation("zh-Hans", chinese, english, plural)).toEqual([])
  })

  it("lets a plural form leave the number out", () => {
    expect(checkTranslation("de", { ...german, "a.days_one": "ein Tag" }, english, plural)).toEqual([])
  })
})

describe("checkEnglish", () => {
  it("fails on a key the source adds, one it dropped, and one whose English changed", () => {
    expect(checkEnglish({ a: "A", b: "B", gone: "G" }, { a: "A", b: "Bee", c: "C" })).toEqual([
      'en: "b" differs from the English in the source',
      'en: missing "c"',
      'en: "gone" is not used in the source',
    ])
  })
})

describe("nest and flatten", () => {
  it("round-trip with sorted keys", () => {
    const flat = { "b.y": "2", "a": "1", "b.x_one": "3" }
    expect(JSON.stringify(nest(flat))).toBe('{"a":"1","b":{"x_one":"3","y":"2"}}')
    expect(flatten(nest(flat))).toEqual({ a: "1", "b.x_one": "3", "b.y": "2" })
  })

  it("refuse a key that is both a text and a group", () => {
    expect(() => nest({ a: "1", "a.b": "2" })).toThrow('"a.b" is under "a", which is already a text')
  })
})
