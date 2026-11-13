import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { TERMS_ACCEPTANCE_STORAGE_KEY, TERMS_VERSION } from "@/config/terms"
import { acceptTerms, hasAcceptedTerms, resetTermsAcceptanceForTests } from "../termsAcceptance"

beforeEach(() => {
  localStorage.removeItem(TERMS_ACCEPTANCE_STORAGE_KEY)
  resetTermsAcceptanceForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the terms acceptance", () => {
  it("is absent until the visitor accepts, then holds the version and the time", () => {
    expect(hasAcceptedTerms()).toBe(false)

    acceptTerms(new Date("2026-11-13T10:00:00.000Z"))

    expect(hasAcceptedTerms()).toBe(true)
    expect(JSON.parse(localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)!)).toEqual({
      version: TERMS_VERSION,
      acceptedAt: "2026-11-13T10:00:00.000Z",
    })
  })

  it("does not count another version or a record that cannot be read", () => {
    for (const stored of [JSON.stringify({ version: "2000-01-01", acceptedAt: "x" }), "not json", "null", "{}", JSON.stringify(TERMS_VERSION)]) {
      localStorage.setItem(TERMS_ACCEPTANCE_STORAGE_KEY, stored)
      expect(hasAcceptedTerms(), stored).toBe(false)
    }
  })

  it("lasts for the visit when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })

    expect(hasAcceptedTerms()).toBe(false)
    acceptTerms()
    expect(hasAcceptedTerms()).toBe(true)
  })
})

describe("TERMS_VERSION", () => {
  it("is the date of the terms' Last updated line, so a change to the terms asks every visitor again", () => {
    const terms = readFileSync(resolve(import.meta.dirname, "../../content/en/terms.md"), "utf8")
    const line = /^Last updated: (\d{1,2}) (\w+) (\d{4})$/m.exec(terms)
    expect(line).not.toBeNull()
    const [, day, month, year] = line!
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const iso = `${year}-${String(months.indexOf(month!) + 1).padStart(2, "0")}-${day!.padStart(2, "0")}`
    expect(TERMS_VERSION).toBe(iso)
  })
})
