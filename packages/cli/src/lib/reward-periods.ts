/**
 * An address's rewards per distribution period, from the Mainnet subgraph, each period checked
 * against the chain at the same block.
 *
 * A period row approximates root lifetime with whole blocks: from its MerkelRootUpdated block
 * to the block before the next update, or to the subgraph's head for the current root.
 * The schema has no root-update log index, so claims before an update in its block also enter
 * the new period's window. These are block windows, not exact event-order attribution. For each, the
 * subgraph gives this address's claims in it, and its cumulative claimed at the period's last
 * block, the running total of its RewardClaim entities. The chain gives
 * `cumulativeClaimed(address)` at that same block. The two must be equal.
 *
 * Every subgraph query is pinned to one indexed block, read first from `_meta`, so the periods and
 * the claims are one consistent view, and no chain read is later than that block. What a period
 * paid out to stakers is not on chain: SEF's files hold it. So a row shows claims, not earnings.
 */
import type { Address, Hash, Hex } from "viem"
import { CONTRACTS, SUBGRAPH_ENDPOINTS, SUBGRAPH_STALE_AFTER_SECONDS, merkleDropAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { redactUrls } from "./redact.js"

export interface RewardPeriod {
  /** 1 for the first distribution. */
  readonly period: number
  readonly root: Hex
  /** The distribution: the block, time and transaction of the root update. */
  readonly setAt: { readonly block: bigint; readonly time: Date; readonly transaction: Hash }
  /** Last block of this window; the next update block minus one, or the indexed head. */
  readonly endBlock: bigint
  readonly current: boolean
  /** This address's claims in the whole-block window; update-block event order is unresolved. */
  readonly claims: number
  readonly claimed: bigint
  /** This address's cumulative claimed at endBlock, by the subgraph and by the chain. */
  readonly cumulativeAtEnd: {
    readonly subgraph: bigint
    readonly chain: bigint
    readonly match: boolean
  }
}

export interface RewardPeriods {
  /** The subgraph block every figure was read at, and how far the subgraph trails the chain. */
  readonly subgraph: {
    readonly block: bigint
    readonly time: Date
    /** Older than core's SUBGRAPH_STALE_AFTER_SECONDS behind the chain head. */
    readonly stale: boolean
    readonly source: string
  }
  readonly periods: readonly RewardPeriod[]
  /** Every period's subgraph figure equals the chain's at the same block. */
  readonly allMatch: boolean
}

/** At most this many entities per query. More would need paging; the reader says so instead. */
const PAGE = 1000
const TIMEOUT_MS = 15_000

interface Meta { _meta: { block: { number: number; timestamp: number | null } } }
interface Periods {
  rewardPeriods: { period: number; root: Hex; blockNumber: string; timestamp: string; transactionHash: Hash }[]
  rewardClaims: { blockNumber: string; amount: string; cumulativeAmount: string }[]
}

async function query<T>(ctx: Context, url: string, text: string): Promise<T> {
  const response = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the subgraph answered HTTP ${response.status}`)
  const body = (await response.json()) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length) throw new Error(`the subgraph answered with an error: ${body.errors[0]?.message ?? "no message"}`)
  if (!body.data) throw new Error("the subgraph answered with no data")
  return body.data
}

/** Parse the endpoint before fetch can repeat a malformed setting in an error. */
export function subgraphUrl(ctx: Context): string {
  let url: URL
  try {
    url = new URL(ctx.subgraphUrl || SUBGRAPH_ENDPOINTS.mainnet)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
  } catch {
    // Do not attach the parser error: it can carry the entire setting, including credentials.
    throw new Error("SUBGRAPH_URL_MAINNET must be an HTTP or HTTPS URL")
  }
  // Canonicalize the scheme so URL redaction also covers mixed-case input in fetch errors.
  return url.href
}

/**
 * The periods for `address`. Throws when the subgraph cannot answer; the caller reports that and
 * shows the claims it read from the chain.
 */
export async function readRewardPeriods(ctx: Context, address: Address): Promise<RewardPeriods> {
  const url = subgraphUrl(ctx)
  const meta = await query<Meta>(ctx, url, "{ _meta { block { number timestamp } } }")
  const head = BigInt(meta._meta.block.number)
  const at = `block: { number: ${head} }`
  const data = await query<Periods>(ctx, url, `{
    rewardPeriods(first: ${PAGE}, orderBy: period, ${at}) { period root blockNumber timestamp transactionHash }
    rewardClaims(first: ${PAGE}, where: { account: "${address.toLowerCase()}" }, orderBy: blockNumber, ${at}) {
      blockNumber amount cumulativeAmount
    }
  }`)
  if (data.rewardPeriods.length >= PAGE || data.rewardClaims.length >= PAGE) {
    throw new Error(`the subgraph holds ${PAGE} or more rows for one query, and this reader does not page`)
  }

  const [chainHead, headBlock] = await Promise.all([
    ctx.client.getBlock(),
    ctx.client.getBlock({ blockNumber: head }),
  ])
  const headTime = new Date(Number(headBlock.timestamp) * 1000)
  const stale = Number(chainHead.timestamp - headBlock.timestamp) > SUBGRAPH_STALE_AFTER_SECONDS

  const claims = data.rewardClaims.map((c) => ({
    block: BigInt(c.blockNumber), amount: BigInt(c.amount), cumulative: BigInt(c.cumulativeAmount),
  }))
  const rows = data.rewardPeriods.map((p, i) => {
    const start = BigInt(p.blockNumber)
    const next = data.rewardPeriods[i + 1]
    const endBlock = next ? BigInt(next.blockNumber) - 1n : head
    const inPeriod = claims.filter((c) => c.block >= start && c.block <= endBlock)
    const before = claims.filter((c) => c.block <= endBlock)
    return {
      period: p.period,
      root: p.root,
      setAt: { block: start, time: new Date(Number(p.timestamp) * 1000), transaction: p.transactionHash },
      endBlock,
      current: !next,
      claims: inPeriod.length,
      claimed: inPeriod.reduce((a, c) => a + c.amount, 0n),
      // handleClaimed adds each uint256 payment to the account's running total. It never
      // decreases, so the maximum is the end-block value even when block-number ties reverse.
      subgraph: before.reduce((max, c) => c.cumulative > max ? c.cumulative : max, 0n),
    }
  })

  // The chain at each period's last block: an archive read, a few at a time.
  const chain: bigint[] = []
  for (let i = 0; i < rows.length; i += 8) {
    chain.push(...(await Promise.all(rows.slice(i, i + 8).map((r) =>
      ctx.client.readContract({
        address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "cumulativeClaimed",
        args: [address], blockNumber: r.endBlock,
      })))))
  }

  const periods: RewardPeriod[] = rows.map(({ subgraph, ...r }, i) => ({
    ...r,
    cumulativeAtEnd: { subgraph, chain: chain[i]!, match: subgraph === chain[i] },
  }))
  return {
    subgraph: {
      block: head,
      time: headTime,
      stale,
      source: "subgraph: safenet-mainnet RewardPeriod and RewardClaim, with approximate block-window claim attribution; chain: MerkleDrop.cumulativeClaimed(address) at each period's last block",
    },
    periods,
    allMatch: periods.every((p) => p.cumulativeAtEnd.match),
  }
}

/** A failed read as the end of a sentence, without the endpoint's URL. */
export function periodsFailure(err: unknown): string {
  const text = err instanceof Error ? (err.message.split("\n")[0] ?? err.name) : String(err)
  return `the subgraph could not give the periods (${redactUrls(text)})`
}
