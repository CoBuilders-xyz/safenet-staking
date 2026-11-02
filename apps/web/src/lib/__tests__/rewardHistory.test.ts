import { readRewardPeriods } from "../../../../../packages/cli/src/lib/reward-periods"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TEST_ACCOUNTS, MOCK_TX_HASH } from "@/__tests__/test-data"
import { answerOperations, meta, mockRequest, STALE_AGE } from "@/__tests__/subgraph-mocks"
import { readRewardHistory, REWARD_HISTORY_CLAIM_LIMIT, type RewardHistoryChain } from "../rewardHistory"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const address = TEST_ACCOUNTS.user
const root = MOCK_TX_HASH
const head = 300
const timestamp = Math.floor(Date.now() / 1000) - 30
const period = (n: number, block = n * 100) => ({
  period: n, root, blockNumber: String(block), timestamp: String(timestamp - head + block), transactionHash: MOCK_TX_HASH,
})
const claim = (id: string, block: number, amount: number, cumulative: number) => ({
  id, account: address, blockNumber: String(block), amount: String(amount), cumulativeAmount: String(cumulative),
})
let periods: ReturnType<typeof period>[]
let claims: ReturnType<typeof claim>[]
let chain: RewardHistoryChain
let indexed: ReturnType<typeof meta>
let total: number
function serve() {
  answerOperations({
    RewardHistoryPeriods: { _meta: indexed, network: { rewardPeriods: total }, rewardPeriods: periods },
    RewardHistoryClaims: { _meta: indexed, rewardClaims: claims },
  })
}
const read = () => readRewardHistory("https://subgraph.test", address, chain)

beforeEach(() => {
  periods = [period(2), period(1)]
  claims = [claim("a", 150, 10, 10), claim("b", 200, 20, 30)]
  indexed = meta(30, head)
  total = 2
  chain = {
    merkleRoot: vi.fn(async () => root),
    cumulativeClaimed: vi.fn(async (block) => block < 100n ? 0n : block < 200n ? 10n : 30n),
  }
})

describe("bounded per-user reward history", () => {
  it("pins claims to the indexed head and checks each cumulative boundary", async () => {
    serve()
    const result = await read()
    expect(result.rows.map((r) => [r.period, r.startBlock, r.endBlock, r.claimed, r.claims]))
      .toEqual([[2, 200n, 300n, 20n, 1], [1, 100n, 199n, 10n, 1]])
    expect(mockRequest.mock.calls.at(-1)![0].variables).toEqual({
      account: address.toLowerCase(), from: "100", block: { number: head }, limit: 1000,
    })
    expect(chain.cumulativeClaimed).toHaveBeenCalledWith(99n)
    expect(chain.cumulativeClaimed).toHaveBeenCalledWith(199n)
    expect(chain.cumulativeClaimed).toHaveBeenCalledWith(300n)
    expect(chain.merkleRoot).toHaveBeenCalledWith(300n)
  })

  it("checks a bounded window against its nonzero historical baseline", async () => {
    total = 20
    periods = Array.from({ length: 12 }, (_, i) => period(20 - i, 290 - i * 10))
    claims = [claim("a", 200, 20, 60)]
    chain.cumulativeClaimed = vi.fn(async (block) => block < 200n ? 40n : 60n)
    serve()
    const result = await read()
    expect(result.rows).toHaveLength(12)
    expect(result.rows.at(-1)!.period).toBe(9)
    expect(result.rows.reduce((sum, r) => sum + r.claimed, 0n)).toBe(20n)
    expect(chain.cumulativeClaimed).toHaveBeenCalledTimes(13)
  })

  it("shows zero only after the chain confirms no claims", async () => {
    claims = []
    chain.cumulativeClaimed = vi.fn(async () => 0n)
    serve()
    expect((await read()).rows.every((r) => r.claimed === 0n && r.claims === 0)).toBe(true)
  })

  it("orders same-block claims by cumulative totals and keeps whole-block attribution", async () => {
    claims = [claim("a", 200, 20, 30), claim("b", 200, 10, 10)]
    chain.cumulativeClaimed = vi.fn(async (block) => block < 200n ? 0n : 30n)
    serve()
    expect((await read()).rows.map((r) => [r.period, r.claimed])).toEqual([[2, 30n], [1, 0n]])
  })

  it.each([
    ["a full claim page", () => { claims = Array.from({ length: REWARD_HISTORY_CLAIM_LIMIT }, () => claims[0]!) }],
    ["a missing middle claim", () => { claims = [claims[1]!] }],
    ["an omitted final claim", () => { claims = [claims[0]!] }],
    ["a false empty account", () => { claims = [] }],
    ["a duplicate claim", () => { claims.push(claims[0]!) }],
    ["another account", () => { claims[0]!.account = TEST_ACCOUNTS.validator1 }],
    ["a claim after the indexed head", () => { claims[1]!.blockNumber = "301" }],
    ["a claim before the window", () => { claims[0]!.blockNumber = "99" }],
    ["a negative payment", () => { claims[0]!.amount = "-10" }],
    ["a missing distribution", () => { periods = [periods[0]!] }],
    ["a skipped sequence number", () => { periods[0]!.period = 3 }],
    ["a repeated update block", () => { periods[0]!.blockNumber = "100" }],
    ["a boundary after the head", () => { periods[0]!.blockNumber = "301" }],
    ["an invalid timestamp", () => { periods[0]!.timestamp = "9007199254740991" }],
    ["a mismatched contract root", () => { chain.merkleRoot = vi.fn(async () => "different") }],
  ] as const)("refuses numeric history for %s", async (_, arrange) => {
    arrange()
    serve()
    await expect(read()).rejects.toMatchObject({ reason: "incomplete" })
  })

  it.each(["stale", "unknown age", "indexing error"] as const)("refuses a %s index before archive work", async (kind) => {
    indexed = meta(kind === "stale" ? STALE_AGE : 30, head, kind === "indexing error")
    const metadata = kind === "unknown age" ? { ...indexed, block: { number: head, timestamp: null } } : indexed
    answerOperations({ RewardHistoryPeriods: { _meta: metadata, network: { rewardPeriods: total }, rewardPeriods: periods } })
    await expect(read()).rejects.toMatchObject({ reason: "stale" })
    expect(chain.cumulativeClaimed).not.toHaveBeenCalled()
  })

  it("rejects a claims response from a different block", async () => {
    answerOperations({
      RewardHistoryPeriods: { _meta: indexed, network: { rewardPeriods: total }, rewardPeriods: periods },
      RewardHistoryClaims: { _meta: meta(30, head + 1), rewardClaims: claims },
    })
    await expect(read()).rejects.toMatchObject({ reason: "incomplete" })
    expect(chain.cumulativeClaimed).not.toHaveBeenCalled()
  })

  it("uses the fresh head timestamp when a pinned query omits it, as live graph-node does", async () => {
    answerOperations({
      RewardHistoryPeriods: { _meta: indexed, network: { rewardPeriods: total }, rewardPeriods: periods },
      RewardHistoryClaims: { _meta: { ...indexed, block: { number: head, timestamp: null } }, rewardClaims: claims },
    })
    expect((await read()).rows.map((r) => r.claimed)).toEqual([20n, 10n])
  })

  it("still rejects indexing errors on a pinned query with no timestamp", async () => {
    answerOperations({
      RewardHistoryPeriods: { _meta: indexed, network: { rewardPeriods: total }, rewardPeriods: periods },
      RewardHistoryClaims: { _meta: { hasIndexingErrors: true, block: { number: head, timestamp: null } }, rewardClaims: claims },
    })
    await expect(read()).rejects.toMatchObject({ reason: "stale" })
  })

  it("propagates archive unavailability without inventing zero claims", async () => {
    chain.cumulativeClaimed = vi.fn(async () => { throw new Error("archive unavailable") })
    serve()
    await expect(read()).rejects.toThrow("archive unavailable")
  })

  it("stops before archive calls when the caller cancels", async () => {
    serve()
    const controller = new AbortController()
    controller.abort()
    await expect(readRewardHistory("https://subgraph.test", address, chain, controller.signal)).rejects.toThrow()
    expect(chain.cumulativeClaimed).not.toHaveBeenCalled()
  })
})

// Exercise the actual CLI/MCP library reader and web adapter against the same source data.
// This catches wiring differences beyond the pure core regression suite.
async function readCli(allPeriods = [...periods].reverse(), allClaims = claims) {
  return readRewardPeriods({
    client: {
      getBlock: async () => ({ timestamp: BigInt(timestamp) }),
      readContract: async ({ blockNumber }: { blockNumber: bigint }) => chain.cumulativeClaimed(blockNumber),
    } as unknown as Parameters<typeof readRewardPeriods>[0]["client"],
    fetch: async (_input, init) => {
      const { query } = JSON.parse(String(init?.body))
      return Response.json({ data: query.includes("_meta")
        ? { _meta: { block: { number: head, timestamp } } }
        : { network: { rewardPeriods: total }, rewardPeriods: allPeriods, rewardClaims: allClaims } })
    },
  }, address)
}

const projectCli = (result: Awaited<ReturnType<typeof readRewardPeriods>>) => result.periods.map((r) => ({
  period: r.period, startBlock: r.setAt.block, endBlock: r.endBlock, timestamp: r.setAt.time.getTime() / 1000,
  transaction: r.setAt.transaction, claims: r.claims, claimed: r.claimed,
})).reverse()

describe("CLI/MCP and web shared-data regression parity", () => {
  it.each(["ordinary", "same-block reversed", "empty"])("attributes %s claims identically", async (kind) => {
    if (kind === "same-block reversed") {
      claims = [claim("b", 200, 20, 30), claim("a", 200, 10, 10)]
      chain.cumulativeClaimed = vi.fn(async (block) => block < 200n ? 0n : 30n)
    } else if (kind === "empty") {
      claims = []
      chain.cumulativeClaimed = vi.fn(async () => 0n)
    }
    serve()
    const [cli, web] = await Promise.all([readCli(), read()])
    expect(web.rows).toEqual(projectCli(cli))
    expect(cli.allMatch).toBe(true)
  })

  it("matches the last twelve CLI periods after verifying the omitted history baseline", async () => {
    total = 20
    const allPeriods = Array.from({ length: total }, (_, i) => period(i + 1, (i + 1) * 10))
    const allClaims = allPeriods.map((p) => claim(String(p.period), Number(p.blockNumber), p.period, p.period * (p.period + 1) / 2))
    periods = allPeriods.slice(-12).reverse()
    claims = allClaims.slice(-12)
    chain.cumulativeClaimed = vi.fn(async (block) => {
      const n = Math.min(total, Math.floor(Number(block) / 10))
      return BigInt(n * (n + 1) / 2)
    })
    serve()
    const [cli, web] = await Promise.all([readCli(allPeriods, allClaims), read()])
    expect(web.rows).toEqual(projectCli(cli).slice(0, 12))
    expect(web.rows.at(-1)!.period).toBe(9)
    expect(web.rows.reduce((sum, r) => sum + r.claimed, 0n)).toBe(174n)
    expect(cli.allMatch).toBe(true)
  })

  it("rejects missing prefixes in both adapters", async () => {
    claims = [claims[1]!]
    serve()
    await expect(readCli()).rejects.toThrow("incomplete or inconsistent reward claims")
    await expect(read()).rejects.toMatchObject({ reason: "incomplete" })
  })

  it("retains CLI mismatch evidence while the web suppresses unverified amounts", async () => {
    claims = [claims[0]!]
    serve()
    const cli = await readCli()
    expect(cli.allMatch).toBe(false)
    expect(cli.periods[1]!.cumulativeAtEnd).toEqual({ subgraph: 10n, chain: 30n, match: false })
    await expect(read()).rejects.toMatchObject({ reason: "incomplete" })
  })

  it("never treats a full page as a successful partial history", async () => {
    claims = Array.from({ length: REWARD_HISTORY_CLAIM_LIMIT }, () => claims[0]!)
    serve()
    await expect(readCli()).rejects.toThrow("1000 or more rows")
    await expect(read()).rejects.toMatchObject({ reason: "incomplete" })
  })
})
