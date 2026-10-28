/**
 * `i18n:extract` writes src/i18n/locales/en.json from the keys and English in the source.
 * `i18n:check`, the same with `--check`, writes nothing and fails when en.json is not what the
 * source implies, or when any other catalogue misses a key, keeps a key the source no longer
 * uses, or changes a placeholder or a tag. `pnpm check` runs the check.
 *
 * The rules a call must follow are in scripts/i18n-catalogues.ts; docs/translations.md at the
 * repository root is the guide for translators.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { LANGUAGES, SOURCE_LANGUAGE } from "../src/i18n/languages"
import { checkEnglish, checkTranslation, extractUsages, flatten, serialise, sourceCatalogue, untranslatedJsx, type Usage } from "./i18n-catalogues"

const ROOT = resolve(import.meta.dirname, "..")
const SRC = join(ROOT, "src")
const LOCALES = join(SRC, "i18n", "locales")
const check = process.argv.includes("--check")

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !f.split(/[\\/]/).includes("__tests__") && !/\.test\.tsx?$/.test(f))
    .filter((f) => !f.endsWith("generated.ts"))
    .sort()
    .map((f) => join(SRC, f))
}

function fail(errors: string[], hint: string): never {
  for (const e of errors) console.error(`  ${e}`)
  console.error(`  ${hint}`)
  process.exit(1)
}

const usages: Usage[] = []
const readErrors: string[] = []
for (const file of sourceFiles()) {
  const source = readFileSync(file, "utf8")
  const result = extractUsages(relative(ROOT, file), source)
  usages.push(...result.usages)
  readErrors.push(...result.errors)
  readErrors.push(...untranslatedJsx(relative(ROOT, file), source))
}
const { catalogue: english, plural, errors: sourceErrors } = sourceCatalogue(usages, SOURCE_LANGUAGE)
if (readErrors.length + sourceErrors.length > 0) {
  fail([...readErrors, ...sourceErrors], "fix the calls above; nothing was written")
}

const englishFile = join(LOCALES, `${SOURCE_LANGUAGE}.json`)
const readCatalogue = (file: string) => flatten(JSON.parse(readFileSync(file, "utf8")))

if (!check) {
  writeFileSync(englishFile, serialise(english))
  console.log(`  wrote ${relative(ROOT, englishFile)}: ${Object.keys(english).length} texts`)
}

const errors = existsSync(englishFile) ? checkEnglish(readCatalogue(englishFile), english) : [`en: ${relative(ROOT, englishFile)} does not exist`]
const expected = new Set(LANGUAGES.map((l) => `${l.code}.json`))
for (const name of readdirSync(LOCALES).filter((f) => f.endsWith(".json"))) {
  if (!expected.has(name)) errors.push(`${name}: no language in src/i18n/languages.ts has this catalogue`)
}
for (const { code } of LANGUAGES) {
  if (code === SOURCE_LANGUAGE) continue
  const file = join(LOCALES, `${code}.json`)
  if (!existsSync(file)) {
    errors.push(`${code}: ${relative(ROOT, file)} does not exist`)
    continue
  }
  errors.push(...checkTranslation(code, readCatalogue(file), english, plural))
}

if (errors.length > 0) {
  fail(errors, check ? "run `pnpm --filter @cobuilders/safenet-web i18n:extract`, then translate what is missing" : "translate what is missing")
}
console.log(`  ${Object.keys(english).length} texts, ${LANGUAGES.length} catalogues, all match the source`)
