import { describe, it, expect } from "vitest"
import { REPOSITORY_REWARDS_BASE, SEF_REWARDS_ENS_NAME } from "@cobuilders/safenet-core"
import { repositoryReason, rewardsSourceHost, rewardsSourceLabel } from "../rewardsSource"

const DATASET = { url: "https://dweb.link/ipfs/bafy", kind: "ens", gateway: "https://dweb.link" } as const

describe("rewardsSourceLabel", () => {
  it("names each kind of source", () => {
    expect(rewardsSourceLabel(DATASET)).toBe("SEF's IPFS dataset (ENS)")
    expect(rewardsSourceLabel(REPOSITORY_REWARDS_BASE)).toBe("SEF's repository")
    expect(rewardsSourceLabel({ url: "https://mock-rewards.test", kind: "override" })).toBe("A configured URL")
  })
})

describe("rewardsSourceHost", () => {
  it("gives the gateway for the dataset and the server for the others", () => {
    expect(rewardsSourceHost(DATASET)).toBe("dweb.link")
    expect(rewardsSourceHost(REPOSITORY_REWARDS_BASE)).toBe("raw.githubusercontent.com")
  })
})

describe("repositoryReason", () => {
  it("says why the mirror was read, for each ENS state", () => {
    expect(repositoryReason({ status: "empty" })).toBe(`${SEF_REWARDS_ENS_NAME} points at no dataset yet.`)
    expect(repositoryReason({ status: "unsupported", raw: "0xdeadbeef", reason: "x" })).toMatch(/cannot read/)
    expect(repositoryReason({ status: "unreadable", reason: "x" })).toMatch(/could not be read/)
    expect(repositoryReason({ status: "set", raw: "0x", contenthash: { protocol: "ipfs", cid: "b" } })).toMatch(/did not answer/)
    expect(repositoryReason(null)).toBeUndefined()
  })
})
