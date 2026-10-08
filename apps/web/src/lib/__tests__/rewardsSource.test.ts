import { describe, it, expect } from "vitest"
import { REPOSITORY_REWARDS_BASE, SEF_REWARDS_ENS_NAME } from "@cobuilders/safenet-core"
import { proofAbsenceCaveat, repositoryReason, rewardsSourceHost, rewardsSourceLabel } from "../rewardsSource"

const DATASET = { url: "https://ipfs.filebase.io/ipfs/bafy", kind: "ens", gateway: "https://ipfs.filebase.io" } as const

describe("rewardsSourceLabel", () => {
  it("names each kind of source", () => {
    expect(rewardsSourceLabel(DATASET)).toBe("SEF's IPFS dataset (ENS)")
    expect(rewardsSourceLabel(REPOSITORY_REWARDS_BASE)).toBe("SEF's repository")
    expect(rewardsSourceLabel({ url: "https://mock-rewards.test", kind: "override" })).toBe("A configured URL")
  })
})

describe("rewardsSourceHost", () => {
  it("gives the gateway for the dataset and the server for the others", () => {
    expect(rewardsSourceHost(DATASET)).toBe("ipfs.filebase.io")
    expect(rewardsSourceHost(REPOSITORY_REWARDS_BASE)).toBe("raw.githubusercontent.com")
  })

  it("resolves a relative override against the page instead of throwing", () => {
    expect(rewardsSourceHost({ url: "/rewards", kind: "override" })).toBe(location.host)
  })
})

describe("repositoryReason", () => {
  const set = { status: "set", raw: "0x", contenthash: { protocol: "ipfs", cid: "b" } } as const
  const found = { base: REPOSITORY_REWARDS_BASE, outcome: "found" } as const

  it("says why the mirror was read, for each ENS state", () => {
    expect(repositoryReason({ status: "empty" }, [found])).toBe(`${SEF_REWARDS_ENS_NAME} points at no dataset yet.`)
    expect(repositoryReason({ status: "unsupported", raw: "0xdeadbeef", reason: "x" }, [found])).toMatch(/cannot read/)
    expect(repositoryReason({ status: "unreadable", reason: "x" }, [found])).toMatch(/could not be read/)
    expect(repositoryReason(null, [])).toBeUndefined()
  })

  it("tells a dataset without the file apart from one that did not answer", () => {
    expect(repositoryReason(set, [{ base: DATASET, outcome: "not found" }, found])).toBe(
      "SEF's IPFS dataset has no latest.json at the expected path.",
    )
    expect(repositoryReason(set, [{ base: DATASET, outcome: "error" }, found])).toMatch(/did not answer/)
    expect(repositoryReason(set, [{ base: DATASET, outcome: "not found" }, { base: DATASET, outcome: "timeout" }, found]))
      .toMatch(/did not answer/)
  })
})

describe("proofAbsenceCaveat", () => {
  const notFound = { base: REPOSITORY_REWARDS_BASE, outcome: "not found" } as const

  it("qualifies a missing proof that only the mirror settled, while the dataset did not answer", () => {
    expect(proofAbsenceCaveat({ base: REPOSITORY_REWARDS_BASE, tried: [{ base: DATASET, outcome: "error" }, notFound] }))
      .toMatch(/did not answer, so this rests on SEF's repository, a mirror/)
  })

  it("says nothing when the dataset was not tried, answered 404 too, or the source is unknown", () => {
    expect(proofAbsenceCaveat({ base: REPOSITORY_REWARDS_BASE, tried: [notFound] })).toBeUndefined()
    expect(proofAbsenceCaveat({ base: REPOSITORY_REWARDS_BASE, tried: [{ base: DATASET, outcome: "not found" }, notFound] }))
      .toBeUndefined()
    expect(proofAbsenceCaveat(undefined)).toBeUndefined()
  })
})
