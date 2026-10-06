import { describe, it, expect } from "vitest"
import { hhi, withShares } from "../distribution"

describe("withShares", () => {
  it("gives each stake as a fraction of the total", () => {
    const rows = withShares([{ stake: 3n }, { stake: 1n }])
    expect(rows.map((r) => r.share)).toEqual([0.75, 0.25])
  })

  it("gives zero shares when nothing is staked, rather than dividing by zero", () => {
    expect(withShares([{ stake: 0n }, { stake: 0n }]).map((r) => r.share)).toEqual([0, 0])
  })
})

describe("hhi", () => {
  it("is 10,000 when one validator holds everything", () => {
    expect(hhi([{ share: 1 }, { share: 0 }])).toBe(10_000)
  })

  it("is 10,000 / n for n equal validators", () => {
    expect(hhi(Array.from({ length: 4 }, () => ({ share: 0.25 })))).toBe(2_500)
  })

  it("sums squared percentage shares: 50, 30 and 20 percent give 2,500 + 900 + 400", () => {
    expect(hhi([0.5, 0.3, 0.2].map((share) => ({ share })))).toBe(3_800)
  })
})
