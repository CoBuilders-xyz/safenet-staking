import { describe, it, expect } from "vitest"
import { pageImports, routeImportFor } from "@/routes"

describe("routeImportFor", () => {
  it("picks the page HashRouter will render for each route", () => {
    expect(routeImportFor("")).toBe(pageImports.Overview)
    expect(routeImportFor("#/")).toBe(pageImports.Overview)
    expect(routeImportFor("#/dashboard")).toBe(pageImports.Dashboard)
    expect(routeImportFor("#/validators")).toBe(pageImports.Validators)
    expect(routeImportFor("#/validators?delegate=0xabc")).toBe(pageImports.Validators)
    expect(routeImportFor("#/validators/0xabc")).toBe(pageImports.ValidatorDetail)
    expect(routeImportFor("#/withdrawals")).toBe(pageImports.Withdrawals)
    expect(routeImportFor("#/rewards")).toBe(pageImports.Rewards)
    for (const path of ["#/imprint", "#/terms", "#/privacy", "#/faq"]) {
      expect(routeImportFor(path)).toBe(pageImports.Content)
    }
    expect(routeImportFor("#/terms/more")).toBe(pageImports.NotFound)
    expect(routeImportFor("#/nowhere")).toBe(pageImports.NotFound)
    expect(routeImportFor("#/validators/0xabc/more")).toBe(pageImports.NotFound)
  })
})
