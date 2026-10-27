import { describe, it, expect } from "vitest"
import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { definition, unstakingPeriodText, type GlossaryTerm } from "../glossary"

const TERMS: GlossaryTerm[] = ["safenet", "staking", "validator", "commission", "unstakingPeriod", "rewards", "slashing"]

describe("glossary", () => {
  it("defines every term in plain sentences", () => {
    for (const term of TERMS) {
      const text = definition(term)
      expect(text.length, term).toBeGreaterThan(40)
      expect(text.trim().endsWith("."), term).toBe(true)
    }
  })

  it("takes the participation threshold from core", () => {
    expect(definition("validator")).toContain(`below ${REWARD_PARTICIPATION_THRESHOLD * 100}% in a reward period`)
  })

  it("names the unstaking period from the contract, or by name before it is read", () => {
    expect(definition("unstakingPeriod", 172_800n)).toContain("for 2 days.")
    expect(definition("unstakingPeriod")).toContain("for the unstaking period.")
    expect(unstakingPeriodText(undefined)).toBe("the unstaking period")
    expect(unstakingPeriodText(90_000)).toBe("1 day 1 hour")
  })

  it("says staked SAFE is not currently subject to slashing, as SEF's risks page does", () => {
    expect(definition("slashing")).toContain("not currently subject to slashing")
  })
})
