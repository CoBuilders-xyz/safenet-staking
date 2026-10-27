import { describe, it, expect, vi, beforeEach } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import { encodeFunctionResult, numberToHex, pad, type Hex } from "viem"
import {
  REPOSITORY_REWARDS_BASE, REWARDS_LATEST_PATH, REWARDS_SOURCE_RETRY_MS, REWARDS_SOURCE_STALE_MS, SEF_DATA, ensResolverAbi,
  ensUniversalResolverAbi, type EnsReadClient,
} from "@cobuilders/safenet-core"
import { readRewardsFileThrough, resolveWebRewardsSource } from "../useRewardsSource"

// ENSIP-7's example contenthash and its CIDv1, as core's tests decode it.
const CONTENTHASH: Hex = "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f"
const CID = "bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4"
const RESOLVER = pad(numberToHex(0xe75), { size: 20 })

/**
 * A Mainnet client whose ENS name holds `contenthash`, counting each lookup: the one eth_call to
 * the Universal Resolver's `resolve` that resolution makes.
 */
function ensClient(contenthash: Hex) {
  const answer = encodeFunctionResult({ abi: ensResolverAbi, functionName: "contenthash", result: contenthash })
  const request = vi.fn<(p: { method: string }) => Promise<Hex>>(async () =>
    encodeFunctionResult({ abi: ensUniversalResolverAbi, functionName: "resolve", result: [answer, RESOLVER] }),
  )
  return { client: { request } as unknown as EnsReadClient, request }
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
    const { client, request } = ensClient(CONTENTHASH)
    const source = await resolveWebRewardsSource(client, "https://mock-rewards.test/")
    expect(source).toEqual({ ens: null, bases: [{ url: "https://mock-rewards.test", kind: "override" }] })
    expect(request).not.toHaveBeenCalled()
  })

  it("puts SEF's IPFS dataset first, gateway by gateway, then the repository", async () => {
    const source = await resolveWebRewardsSource(ensClient(CONTENTHASH).client, undefined)
    expect(source.bases.map((b) => b.url)).toEqual([
      `https://ipfs.orbitor.dev/ipfs/${CID}`,
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
    vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": 504, "ipfs.filebase.io": { epoch: 1 }, "raw.githubusercontent.com": { epoch: 0 } }))
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    expect(read.value).toEqual({ epoch: 1 })
    expect(read.base).toEqual({ url: `https://ipfs.filebase.io/ipfs/${CID}`, kind: "ens", gateway: "https://ipfs.filebase.io" })
    expect(read.url).toBe(`https://ipfs.filebase.io/ipfs/${CID}/latest.json`)
    expect(read.ens?.status).toBe("set")
  })

  it("falls through every gateway to the repository", async () => {
    const fetch = serve({ "ipfs.orbitor.dev": "down", "ipfs.filebase.io": 502, "raw.githubusercontent.com": { epoch: 0 } })
    vi.stubGlobal("fetch", fetch)
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    expect(read.value).toEqual({ epoch: 0 })
    expect(read.base).toEqual(REPOSITORY_REWARDS_BASE)
    expect(fetch.mock.calls.map(([url]) => new URL(url).host)).toEqual([
      "ipfs.orbitor.dev", "ipfs.filebase.io", "raw.githubusercontent.com",
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
    vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": { epoch: 1 } }))
    const { client, request } = ensClient(CONTENTHASH)
    await readRewardsFileThrough(queryClient, client, REWARDS_LATEST_PATH, attempt, signal)
    await readRewardsFileThrough(queryClient, client, "proofs/x.json", attempt, signal)
    expect(request.mock.calls.filter(([p]) => p.method === "eth_call")).toHaveLength(1)
  })

  it("reads no proof, not an error, when a gateway fails and the repository answers 404", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": 429 }))
    const read = await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, "proofs/x.json", attempt, signal)
    expect(read.value).toBeNull()
    expect(read.base).toEqual(REPOSITORY_REWARDS_BASE)
    expect(read.tried.map((a) => a.outcome)).toEqual(["error", "not found", "not found"])
  })

  it("keeps the resolution for the hour with no component observing it", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": { epoch: 1 } }))
    await readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal)
    const query = queryClient.getQueryCache().find({ queryKey: ["rewardsSource"] })
    expect(query?.gcTime).toBe(REWARDS_SOURCE_STALE_MS)
  })

  it("reads the name again a minute after a failed read, and keeps a set name for the hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_800_000_000_000 })
    try {
      vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": { epoch: 1 }, "raw.githubusercontent.com": { epoch: 0 } }))
      const { client, request } = ensClient(CONTENTHASH)
      request.mockRejectedValueOnce(new Error("RPC blip"))
      const lookups = () => request.mock.calls.filter(([p]) => p.method === "eth_call").length
      const read = () => readRewardsFileThrough(queryClient, client, REWARDS_LATEST_PATH, attempt, signal)

      expect((await read()).ens?.status).toBe("unreadable")
      vi.setSystemTime(Date.now() + REWARDS_SOURCE_RETRY_MS - 1)
      await read()
      expect(lookups()).toBe(1)
      vi.setSystemTime(Date.now() + 2)
      expect((await read()).ens?.status).toBe("set")
      expect(lookups()).toBe(2)
      vi.setSystemTime(Date.now() + REWARDS_SOURCE_STALE_MS - 1)
      await read()
      expect(lookups()).toBe(2)
      vi.setSystemTime(Date.now() + 2)
      await read()
      expect(lookups()).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("throws the repository's own error when it was the only source and failed", async () => {
    vi.stubGlobal("fetch", serve({ "raw.githubusercontent.com": 500 }))
    await expect(
      readRewardsFileThrough(queryClient, ensClient("0x").client, REWARDS_LATEST_PATH, attempt, signal),
    ).rejects.toThrow("Failed to fetch rewards file: 500")
  })

  it("names every source when all of them fail", async () => {
    vi.stubGlobal("fetch", serve({ "ipfs.orbitor.dev": 502, "ipfs.filebase.io": "down", "raw.githubusercontent.com": 500 }))
    await expect(
      readRewardsFileThrough(queryClient, ensClient(CONTENTHASH).client, REWARDS_LATEST_PATH, attempt, signal),
    ).rejects.toThrow(/ipfs\.orbitor\.dev: .*502; ipfs\.filebase\.io: Failed to fetch; raw\.githubusercontent\.com: .*500/)
  })
})
