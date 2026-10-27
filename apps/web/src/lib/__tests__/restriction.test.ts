import { describe, it, expect } from "vitest"
import { countryName, restrictionCopy, type Restriction } from "../restriction"

const ALL: Restriction[] = [
  { gate: "sanctionsApi", reason: "refused" },
  { gate: "sanctionsApi", reason: "unavailable" },
  { gate: "geoblock", reason: "region", country: "IR" },
  { gate: "geoblock", reason: "unavailable" },
  { gate: "walletSanctions", reason: "flagged" },
  { gate: "walletSanctions", reason: "unavailable" },
]

describe("restrictionCopy", () => {
  it("gives every gate and reason a title, a gate name, a reason and a remedy", () => {
    for (const r of ALL) {
      const copy = restrictionCopy(r)
      for (const field of [copy.title, copy.gate, copy.description, copy.remedy]) expect(field.length).toBeGreaterThan(0)
    }
  })

  it("names a different gate for each of the three checks", () => {
    const gates = new Set(ALL.map((r) => restrictionCopy(r).gate))
    expect([...gates].sort()).toEqual(["Location check", "Sanctions screening", "Wallet screening"])
  })

  it("tells a refusal from a check that could not answer", () => {
    for (const r of ALL) {
      const { title, remedy } = restrictionCopy(r)
      if (r.reason === "unavailable") {
        expect(title).toMatch(/Check Failed/)
        expect(remedy).toMatch(/Try again/)
      } else {
        expect(title).toMatch(/Restricted/)
        expect(remedy).toMatch(/cannot lift the restriction/)
      }
    }
  })

  it("names the country the location check found", () => {
    expect(restrictionCopy({ gate: "geoblock", reason: "region", country: "IR" }).description).toContain("Iran")
  })
})

describe("countryName", () => {
  it("falls back to the code when it is not a region", () => {
    expect(countryName("not-a-code")).toBe("not-a-code")
  })
})
