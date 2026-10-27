/**
 * The logic behind `i18n:extract`, with no file system: what the source asks for, the English
 * catalogue that follows from it, and what is wrong with a translated catalogue.
 *
 * The source is the only place English is written. Each key carries its English beside it:
 *
 *   t("overview.hero.title", "Network overview")
 *   t("overview.stat.withdrawn", "{{count}} withdrawn", { count })
 *   t("overview.stat.days", { count, defaultValue_one: "one day", defaultValue_other: "{{count}} days" })
 *   <Trans i18nKey="overview.freshness.live" defaults="live. Block <block>{{block}}</block>" ... />
 *
 * A key must be a string literal, so every key in use is visible here. A file that imports nothing
 * from i18next, react-i18next or @/i18n is not read: a `t` there is some other function.
 */
import ts from "typescript"

/** A flat catalogue: dotted key, plural forms as `_one`, `_other` suffixes, to text. */
export type FlatCatalogue = Record<string, string>

/** Every plural category CLDR defines, in its canonical order. */
const ALL_FORMS = ["zero", "one", "two", "few", "many", "other"] as const

/** The plural forms a language needs, as i18next asks for them through `Intl.PluralRules`. */
export function pluralForms(language: string): string[] {
  const forms: readonly string[] = new Intl.PluralRules(language).resolvedOptions().pluralCategories
  return ALL_FORMS.filter((f) => forms.includes(f))
}

export interface Usage {
  key: string
  plural: boolean
  /** English, by `defaultValue` or `defaultValue_<form>` name. Empty when the call gives none. */
  defaults: Record<string, string>
  at: string
}

const I18N_MODULES = new Set(["i18next", "react-i18next", "@/i18n"])

function importsI18n(file: ts.SourceFile): boolean {
  return file.statements.some(
    (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && I18N_MODULES.has(s.moduleSpecifier.text),
  )
}

function literalText(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text
  return undefined
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

/** Every key one source file uses, and every call this tool cannot read. */
export function extractUsages(fileName: string, text: string): { usages: Usage[]; errors: string[] } {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const usages: Usage[] = []
  const errors: string[] = []
  if (!importsI18n(file)) return { usages, errors }

  const at = (node: ts.Node) => `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

  const readOptions = (node: ts.Expression, usage: Usage) => {
    if (!ts.isObjectLiteralExpression(node)) return
    for (const p of node.properties) {
      const name =
        ts.isPropertyAssignment(p) ? propertyName(p.name) : ts.isShorthandPropertyAssignment(p) ? p.name.text : undefined
      if (name === undefined) continue
      if (name === "count") usage.plural = true
      if (name === "context") errors.push(`${at(p)}: context is not supported; use a separate key`)
      if (name === "defaultValue" || name.startsWith("defaultValue_")) {
        const value = ts.isPropertyAssignment(p) ? literalText(p.initializer) : undefined
        if (value === undefined) errors.push(`${at(p)}: ${name} must be a string literal`)
        else usage.defaults[name] = value
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isT =
        (ts.isIdentifier(callee) && callee.text === "t") ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "t")
      if (isT) {
        const [first, second, third] = node.arguments
        const key = literalText(first)
        if (key === undefined) {
          errors.push(`${at(node)}: the key must be a string literal`)
        } else {
          const usage: Usage = { key, plural: false, defaults: {}, at: at(node) }
          if (second) {
            const text = literalText(second)
            if (text !== undefined) usage.defaults.defaultValue = text
            else if (ts.isObjectLiteralExpression(second)) readOptions(second, usage)
            else errors.push(`${at(second)}: the English text must be a string literal`)
          }
          if (third) readOptions(third, usage)
          usages.push(usage)
        }
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (ts.isIdentifier(node.tagName) && node.tagName.text === "Trans") {
        const usage: Usage = { key: "", plural: false, defaults: {}, at: at(node) }
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue
          const value = attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : undefined
          if (attr.name.text === "i18nKey") usage.key = value ?? ""
          if (attr.name.text === "defaults") {
            if (value === undefined) errors.push(`${at(attr)}: defaults must be a string literal`)
            else usage.defaults.defaultValue = value
          }
          if (attr.name.text === "count") usage.plural = true
        }
        if (usage.key === "") errors.push(`${at(node)}: <Trans> needs a string literal i18nKey`)
        else usages.push(usage)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { usages, errors }
}

/**
 * The English catalogue the usages imply. Two uses of one key must agree on its English and on
 * whether it is plural; a key with no English anywhere is an error.
 */
export function sourceCatalogue(usages: readonly Usage[], language = "en"): { catalogue: FlatCatalogue; plural: Set<string>; errors: string[] } {
  const byKey = new Map<string, Usage[]>()
  for (const u of usages) byKey.set(u.key, [...(byKey.get(u.key) ?? []), u])
  const catalogue: FlatCatalogue = {}
  const plural = new Set<string>()
  const errors: string[] = []

  for (const [key, uses] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
    const isPlural = uses.some((u) => u.plural)
    if (uses.some((u) => u.plural !== isPlural)) {
      errors.push(`"${key}" is used both with and without count: ${uses.map((u) => u.at).join(", ")}`)
      continue
    }
    const withText = uses.filter((u) => Object.keys(u.defaults).length > 0)
    if (withText.length === 0) {
      errors.push(`"${key}" has no English text: ${uses[0].at}`)
      continue
    }
    const first = JSON.stringify(withText[0].defaults)
    const disagree = withText.find((u) => JSON.stringify(u.defaults) !== first)
    if (disagree) {
      errors.push(`"${key}" has different English at ${withText[0].at} and ${disagree.at}`)
      continue
    }
    const defaults = withText[0].defaults
    if (isPlural) {
      plural.add(key)
      for (const form of pluralForms(language)) {
        const text = defaults[`defaultValue_${form}`] ?? defaults.defaultValue
        if (text === undefined) errors.push(`"${key}" has no English for the plural form "${form}": ${withText[0].at}`)
        else catalogue[`${key}_${form}`] = text
      }
    } else {
      catalogue[key] = defaults.defaultValue ?? ""
      if (defaults.defaultValue === undefined) errors.push(`"${key}" has plural English but no count: ${withText[0].at}`)
    }
  }
  return { catalogue, plural, errors }
}

/** `{{name}}` placeholders, by name, ignoring any format after a comma. */
function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((m) => m[1]))
}

/** Trans tags, `<block>`, `</block>`, `<br/>`, as a sorted list so a missing close shows. */
function tags(text: string): string {
  return [...text.matchAll(/<\/?[A-Za-z0-9]+\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")).sort().join(" ")
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

/**
 * What is wrong with one translated catalogue against the source: a key missing, a key the source
 * does not use, an empty text, a placeholder or a tag that differs from the English.
 */
export function checkTranslation(
  language: string,
  translation: FlatCatalogue,
  english: FlatCatalogue,
  plural: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  const required = new Map<string, string>() // key in this language -> its English
  const allowed = new Set<string>()
  for (const key of Object.keys(english)) {
    const base = key.replace(/_(zero|one|two|few|many|other)$/, "")
    if (!plural.has(base)) {
      required.set(key, english[key])
      allowed.add(key)
    }
  }
  for (const base of plural) {
    const other = english[`${base}_other`]
    for (const form of pluralForms(language)) required.set(`${base}_${form}`, other)
    // A browser with newer plural data may ask for a form this runtime does not know.
    for (const form of ALL_FORMS) allowed.add(`${base}_${form}`)
  }

  for (const [key, source] of required) {
    const text = translation[key]
    if (text === undefined) {
      errors.push(`${language}: missing "${key}"`)
      continue
    }
    if (text.trim() === "") {
      errors.push(`${language}: "${key}" is empty`)
      continue
    }
    const want = placeholders(source)
    const got = placeholders(text)
    // A plural form may leave the number out, as "один" or "un" can stand for it.
    if (plural.has(key.replace(/_(zero|one|two|few|many|other)$/, ""))) {
      want.delete("count")
      got.delete("count")
    }
    if (!sameSet(want, got)) {
      errors.push(`${language}: "${key}" has placeholders {${[...got].join(", ")}}, English has {${[...want].join(", ")}}`)
    }
    if (tags(text) !== tags(source)) errors.push(`${language}: "${key}" has tags "${tags(text)}", English has "${tags(source)}"`)
  }
  for (const key of Object.keys(translation)) {
    if (!allowed.has(key)) errors.push(`${language}: "${key}" is not used in the source`)
  }
  return errors
}

/** The English catalogue on disk against the one the source implies. */
export function checkEnglish(onDisk: FlatCatalogue, fromSource: FlatCatalogue): string[] {
  const errors: string[] = []
  for (const key of Object.keys(fromSource)) {
    if (!(key in onDisk)) errors.push(`en: missing "${key}"`)
    else if (onDisk[key] !== fromSource[key]) errors.push(`en: "${key}" differs from the English in the source`)
  }
  for (const key of Object.keys(onDisk)) {
    if (!(key in fromSource)) errors.push(`en: "${key}" is not used in the source`)
  }
  return errors
}

type Nested = { [key: string]: string | Nested }

/** A nested catalogue, as i18next reads it, to dotted keys. Anything but text and objects is an error. */
export function flatten(nested: unknown, prefix = ""): FlatCatalogue {
  const out: FlatCatalogue = {}
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    throw new Error(`${prefix || "the catalogue"} must be an object`)
  }
  for (const [k, v] of Object.entries(nested)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}

/** Dotted keys to the nested form i18next reads, keys sorted, so a rewrite is a stable diff. */
export function nest(flat: FlatCatalogue): Nested {
  const root: Nested = {}
  for (const key of Object.keys(flat).sort()) {
    const parts = key.split(".")
    let node = root
    for (const part of parts.slice(0, -1)) {
      const next = node[part]
      if (typeof next === "string") throw new Error(`"${key}" is under "${part}", which is already a text`)
      node = (node[part] ??= {}) as Nested
    }
    const leaf = parts[parts.length - 1]
    if (typeof node[leaf] === "object") throw new Error(`"${key}" is both a text and a group of keys`)
    node[leaf] = flat[key]
  }
  return root
}

export function serialise(flat: FlatCatalogue): string {
  return `${JSON.stringify(nest(flat), null, 2)}\n`
}
