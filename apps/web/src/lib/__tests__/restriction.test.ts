import { describe, it, expect } from "vitest"
import { chooseRestriction, countryName, restrictionCopy, type Restriction } from "../restriction"

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

describe("chooseRestriction", () => {
  const open = { allowed: true }

  it("is undefined while every gate is open", () => {
    expect(chooseRestriction([{ gate: "sanctionsApi", ...open }, { gate: "geoblock", ...open }])).toBeUndefined()
  })

  it("names the first gate when both refuse", () => {
    expect(
      chooseRestriction([
        { gate: "sanctionsApi", allowed: false, restriction: { gate: "sanctionsApi", reason: "refused" } },
        { gate: "geoblock", allowed: false, restriction: { gate: "geoblock", reason: "region", country: "CU" } },
      ]),
    ).toEqual({ gate: "sanctionsApi", reason: "refused" })
  })

  it("names a refusal before a check that could not answer, whatever the order", () => {
    expect(
      chooseRestriction([
        { gate: "sanctionsApi", allowed: false, restriction: { gate: "sanctionsApi", reason: "unavailable" } },
        { gate: "geoblock", allowed: false, restriction: { gate: "geoblock", reason: "region", country: "CU" } },
      ]),
    ).toEqual({ gate: "geoblock", reason: "region", country: "CU" })
  })

  it("names the first failed check when no gate refused", () => {
    expect(
      chooseRestriction([
        { gate: "sanctionsApi", allowed: false, restriction: { gate: "sanctionsApi", reason: "unavailable" } },
        { gate: "geoblock", allowed: false, restriction: { gate: "geoblock", reason: "unavailable" } },
      ]),
    ).toEqual({ gate: "sanctionsApi", reason: "unavailable" })
  })

  it("treats a closed gate without a reason as a failed check of that gate", () => {
    expect(chooseRestriction([{ gate: "sanctionsApi", ...open }, { gate: "geoblock", allowed: false }])).toEqual({
      gate: "geoblock",
      reason: "unavailable",
    })
  })
})
