// @vitest-environment node
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { latestDeployment, parseDeployments } from "../availability-checks"

/**
 * The committed record at the repository root. A malformed edit would fail the availability run
 * every six hours; here it fails the pull request that makes it.
 */
const path = resolve(import.meta.dirname, "../../../../deployments.json")

describe("deployments.json", () => {
  it("exists, parses, and names a latest release", () => {
    expect(existsSync(path)).toBe(true)
    const deployments = parseDeployments(readFileSync(path, "utf8"))
    expect(deployments.length).toBeGreaterThan(0)
    expect(latestDeployment(deployments)).toBeDefined()
  })

  it("records each CID once", () => {
    const cids = parseDeployments(readFileSync(path, "utf8")).map((d) => d.cid)
    expect(new Set(cids).size).toBe(cids.length)
  })

  it("dates no pin in the future", () => {
    for (const { pinnedAt } of parseDeployments(readFileSync(path, "utf8"))) {
      expect(Date.parse(pinnedAt)).toBeLessThanOrEqual(Date.now())
    }
  })
})
