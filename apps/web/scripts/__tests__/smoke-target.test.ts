// @vitest-environment node
import { describe, it, expect } from "vitest"
import { smokeTarget } from "../../e2e/smoke/target"

const PRODUCTION = "https://app.example.test"
const ENS = "https://app.example.eth.limo"

describe("smokeTarget", () => {
  it("checks PRODUCTION_URL, as the Safe App origin, when SMOKE_URL is unset", () => {
    expect(smokeTarget({ PRODUCTION_URL: PRODUCTION })).toEqual({ url: `${PRODUCTION}/`, safeApp: true })
  })

  it("checks SMOKE_URL when set, and not as the Safe App origin", () => {
    expect(smokeTarget({ PRODUCTION_URL: PRODUCTION, SMOKE_URL: ENS })).toEqual({ url: `${ENS}/`, safeApp: false })
    expect(smokeTarget({ SMOKE_URL: `${ENS}/ipfs/bafy` })).toEqual({ url: `${ENS}/ipfs/bafy/`, safeApp: false })
  })

  it("treats SMOKE_URL equal to PRODUCTION_URL as the Safe App origin", () => {
    expect(smokeTarget({ PRODUCTION_URL: PRODUCTION, SMOKE_URL: `${PRODUCTION}/` }).safeApp).toBe(true)
  })

  it("refuses to run without either, or with a value that is not a URL", () => {
    expect(() => smokeTarget({})).toThrow(/SMOKE_URL/)
    expect(() => smokeTarget({ SMOKE_URL: "not a url" })).toThrow(/SMOKE_URL is not a URL/)
  })
})
