import { describe, it, expect, vi, beforeEach } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import { numberToHex, pad, type Hex } from "viem"
import {
  REPOSITORY_REWARDS_BASE, REWARDS_LATEST_PATH, REWARDS_SOURCE_STALE_MS, SEF_DATA, type EnsReadClient,
} from "@cobuilders/safenet-core"
import { readRewardsFileThrough, resolveWebRewardsSource } from "../useRewardsSource"

// ENSIP-7's example contenthash and its CIDv1, as core's tests decode it.
const CONTENTHASH: Hex = "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f"
const CID = "bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4"
const RESOLVER = pad(numberToHex(0xe75), { size: 20 })

/** A Mainnet client whose ENS name holds `contenthash`, counting each lookup. */
function ensClient(contenthash: Hex) {
  const readContract = vi.fn(async (p: { functionName: string }) =>
    p.functionName === "findResolver" ? [RESOLVER, `0x${"00".repeat(32)}`, 0n] : contenthash,
  )
  return { client: { readContract } as unknown as EnsReadClient, readContract }
}

/** A fetch that answers per host: a body, a status, or a network failure. */
function serve(byHost: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const answer = byHost[new URL(url).host]
    if (answer === undefined) return { ok: false, status: 404 }
    if (answer === "down") throw new TypeError("Failed to fetch")
    if (typeof answer === "number") return { ok: false, status: answer }
    return { ok: true, status: 200, json: async () => answer }
  })
}

/** The attempt the hooks pass: null on 404, an error on any other failure. */
async function attempt(url: string, signal: AbortSignal) {
  const response = (await fetch(url, { signal })) as unknown as { ok: boolean; status: number; json: () => Promise<unknown> }
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to fetch rewards file: ${response.status}`)
  return response.json()
}

describe("resolveWebRewardsSource", () => {
  it("lets the configured URL replace every source, and reads no ENS name", async () => {
    const { client, readContract } = ensClient(CONTENTHASH)
    const source = await resolveWebRewardsSource(client, "https://mock-rewards.test/")
    expect(source).toEqual({ ens: null, bases: [{ url: "https://mock-rewards.test", kind: "override" }] })
    expect(readContract).not.toHaveBeenCalled()
  })

  it("puts SEF's IPFS dataset first, gateway by gateway, then the repository", async () => {
    const source = await resolveWebRewardsSource(ensClient(CONTENTHASH).client, undefined)
    expect(source.bases.map((b) => b.url)).toEqual([
      `https://ipfs.io/ipfs/${CID}`,
      `https://dweb.link/ipfs/${CID}`,
      `https://ipfs.filebase.io/ipfs/${CID}`,
      SEF_DATA.rewardsProofBase,
    ])
  })

  it("reads only the repository while the contenthash is empty", async () => {
    const source = await resolveWebRewardsSource(ensClient("0x").client, undefined)
    expect(source).toEqual({ ens: { status: "empty" }, bases: [REPOSITORY_REWARDS_BASE] })
  })

  it("reads only the repository without a Mainnet client", async () => {
    const source = await resolveWebRewardsSource(undefined, undefined)
    expect(source.bases).toEqual([REPOSITORY_REWARDS_BASE])
    expect(source.ens?.status).toBe("unreadable")
  })
})

describe("readRewardsFileThrough", () => {
  let queryClient: QueryClient
  const signal = new AbortController().signal

  beforeEach(() => {
    queryClient = new QueryClient()
    vi.unstubAllGlobals()
  })

  it("reads the dataset through the first gateway that answers", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.io": 504, "dweb.link": { epoch: 1 }, "raw.githubusercontent.com": { epoch: 0 } }))
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    expect(read.value).toEqual({ epoch: 1 })
    expect(read.base).toEqual({ url: `https://dweb.link/ipfs/${CID}`, kind: "ens", gateway: "https://dweb.link" })
    expect(read.url).toBe(`https://dweb.link/ipfs/${CID}/latest.json`)
    expect(read.ens?.status).toBe("set")
  })

  it("falls through every gateway to the repository", async () => {
    const fetch = serve({ "ipfs.io": "down", "dweb.link": 502, "raw.githubusercontent.com": { epoch: 0 } })
    vi.stubGlobal("fetch", fetch)
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    expect(read.value).toEqual({ epoch: 0 })
    expect(read.base).toEqual(REPOSITORY_REWARDS_BASE)
    expect(fetch.mock.calls.map(([url]) => new URL(url).host)).toEqual([
      "ipfs.io", "dweb.link", "ipfs.filebase.io", "raw.githubusercontent.com",
    ])
  })

  it("reads the repository directly while the contenthash is empty", async () => {
    const fetch = serve({ "raw.githubusercontent.com": { epoch: 0 } })
    vi.stubGlobal("fetch", fetch)
    const read = await readRewardsFileThrough(queryClient, ensClient("0x").client, REWARDS_LATEST_PATH, attempt, signal)
    expect(read.base).toEqual(REPOSITORY_REWARDS_BASE)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("resolves the ENS name once per session, not once per file", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.io": { epoch: 1 } }))
    const { client, readContract } = ensClient(CONTENTHASH)
    await readRewardsFileThrough(queryClient, client, REWARDS_LATEST_PATH, attempt, signal)
    await readRewardsFileThrough(queryClient, client, "proofs/x.json", attempt, signal)
    expect(readContract.mock.calls.filter(([p]) => p.functionName === "findResolver")).toHaveLength(1)
  })

  it("reads no proof, not an error, when a gateway fails and the repository answers 404", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.io": 429 }))
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, "proofs/x.json", attempt, signal)
    expect(read.value).toBeNull()
    expect(read.base).toEqual(REPOSITORY_REWARDS_BASE)
    expect(read.tried.map((a) => a.outcome)).toEqual(["error", "not found", "not found", "not found"])
  })

  it("keeps the resolution for the hour with no component observing it", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.io": { epoch: 1 } }))
    await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    const query = queryClient.getQueryCache().find({ queryKey: ["rewardsSource"] })
    expect(query?.gcTime).toBe(REWARDS_SOURCE_STALE_MS)
  })

  it("throws the repository's own error when it was the only source and failed", async () => {
    vi.stubGlobal("fetch", serve({ "raw.githubusercontent.com": 500 }))
    await expect(
      readRewardsFileThrough(queryClient, ensClient("0x").client, REWARDS_LATEST_PATH, attempt, signal),
    ).rejects.toThrow("Failed to fetch rewards file: 500")
  })

  it("names every source when all of them fail", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.io": 502, "dweb.link": 502, "ipfs.filebase.io": "down", "raw.githubusercontent.com": 500 }))
    await expect(
      readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal),
    ).rejects.toThrow(/ipfs\.io: .*502; dweb\.link: .*502; ipfs\.filebase\.io: Failed to fetch; raw\.githubusercontent\.com: .*500/)
  })
})
