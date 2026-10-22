import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { pad, toHex } from "viem"
import { parseRewardsLatest } from "@/hooks/useProgrammeRewards"
import { generateRewards, type MerkleConfig } from "../generate-merkle-tree"

const addr = (n: number) => pad(toHex(n), { size: 20 })

const CONFIG: MerkleConfig = {
  epoch: 3,
  entries: {
    [addr(1)]: (2n * 10n ** 18n).toString(),
    [addr(2)]: (5n * 10n ** 17n).toString(),
  },
}

describe("generateRewards", () => {
  let out: string

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), "rewards-"))
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(out, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("writes a latest.json the app's own parser accepts", () => {
    const now = new Date("2026-09-22T08:00:00.000Z")
    const written = generateRewards(CONFIG, out, now)

    const latest = parseRewardsLatest(JSON.parse(readFileSync(join(out, "latest.json"), "utf-8")))
    expect(latest).toEqual(written)
    expect(latest).toEqual({
      epoch: 3,
      merkleRoot: written.merkleRoot,
      rewardsUntil: now.toISOString(),
      tokenTotal: (25n * 10n ** 17n).toString(),
      unpaidAmount: "0",
    })
  })

  it("carries rewardsUntil and unpaidAmount from the config", () => {
    const latest = generateRewards(
      { ...CONFIG, rewardsUntil: "2026-09-22T00:00:00.000Z", unpaidAmount: "15" },
      out,
    )
    expect(parseRewardsLatest(latest)).toMatchObject({
      rewardsUntil: "2026-09-22T00:00:00.000Z",
      unpaidAmount: "15",
    })
  })

  it("rejects a rewardsUntil that is not ISO 8601, and writes a valid one in UTC", () => {
    expect(() => generateRewards({ ...CONFIG, rewardsUntil: "09/22/2026" }, out)).toThrow(
      'rewardsUntil must be an ISO 8601 date, got "09/22/2026"',
    )
    const latest = generateRewards({ ...CONFIG, rewardsUntil: "2026-09-22T02:00:00+02:00" }, out)
    expect(latest.rewardsUntil).toBe("2026-09-22T00:00:00.000Z")
  })

  it("writes each proof under the radix path of the lower-case address", () => {
    const { merkleRoot } = generateRewards(CONFIG, out)
    const lower = addr(2).toLowerCase()
    const radix = lower.slice(2, 10).match(/../g)!.join("/")
    const proof = JSON.parse(readFileSync(join(out, "proofs", radix, `${lower}.json`), "utf-8"))
    expect(proof).toMatchObject({ cumulativeAmount: (5n * 10n ** 17n).toString(), merkleRoot })
  })
})
