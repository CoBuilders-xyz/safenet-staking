/** Complete indexed history at one pinned block, followed by RPC logs through the caller's head.
 * No partial result escapes: malformed pages, stale indexes and failed tails use the full RPC scan.
 */
import { z } from "zod"
import { CONTRACTS, SUBGRAPH_STALE_AFTER_SECONDS, withSubgraphFallback } from "@cobuilders/safenet-core"
import type { Address } from "viem"
import type { Context } from "./context.js"
import { subgraphUrl } from "./reward-periods.js"
import { SafenetError } from "./errors.js"

const uint = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt)
const hash = z.string().regex(/^0x[0-9a-f]{64}$/)
const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const count = z.number().int().nonnegative().safe()
const metaSchema = z.object({ _meta: z.object({
  hasIndexingErrors: z.literal(false),
  block: z.object({ number: count, hash, timestamp: count }),
}) })
const claimSchema = z.object({
  id: z.string(), account: address, amount: uint, blockNumber: uint, timestamp: uint, transactionHash: hash,
}).transform((row, ctx) => {
  const suffix = row.id.slice(row.transactionHash.length + 1)
  if (!row.id.startsWith(`${row.transactionHash}-`) || !/^(0|[1-9][0-9]*)$/.test(suffix) || !Number.isSafeInteger(Number(suffix))) {
    ctx.addIssue({ code: "custom", message: "invalid claim id" })
    return z.NEVER
  }
  return { ...row, logIndex: Number(suffix) }
})
const withdrawalSchema = z.object({
  id: z.string().regex(/^(0|[1-9][0-9]*)$/), staker: address, amount: uint, claimed: z.boolean(),
  initiatedAtBlock: uint, initiatedAtTimestamp: uint, initiatedTxHash: hash,
  claimedAtBlock: uint.nullable(), claimedAtTimestamp: uint.nullable(), claimedTxHash: hash.nullable(),
})
export type IndexedClaim = z.output<typeof claimSchema>
export type IndexedWithdrawal = z.output<typeof withdrawalSchema>
const PAGE = 1000

/** Fetch one history query with a deadline and a credential-free failure message. */
async function query(ctx: Context, url: string, query: string): Promise<unknown> {
  // Never propagate provider bodies, URLs, or validation input: overrides may carry credentials.
  try {
    const response = await ctx.fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error()
    const body = await response.json() as { data?: unknown; errors?: unknown[] }
    if (!body.data || body.errors?.length) throw new Error()
    return body.data
  } catch { throw new SafenetError("the history subgraph request failed (HTTP, GraphQL, timeout or invalid response)") }
}

/** Verify the indexed snapshot against the captured chain head, including reorg and stale-data checks. */
async function snapshot(ctx: Context, endpoint: string, head: bigint) {
  let parsed = metaSchema.safeParse(await query(ctx, endpoint, "{ _meta { block { number hash timestamp } hasIndexingErrors } }"))
  // The index can advance while the RPC head is captured. Ask for that earlier snapshot.
  if (parsed.success && BigInt(parsed.data._meta.block.number) > head) {
    parsed = metaSchema.safeParse(await query(ctx, endpoint,
      `{ _meta(block: { number: ${head} }) { block { number hash timestamp } hasIndexingErrors } }`))
  }
  if (!parsed.success) throw new SafenetError("the history subgraph metadata is incomplete or has indexing errors")
  const meta = parsed.data._meta.block
  const block = BigInt(meta.number)
  if (block > head || block < CONTRACTS.merkleDrop.deployBlock) throw new SafenetError("the history subgraph block is outside the requested range")
  const [indexed, latest] = await Promise.all([
    ctx.client.getBlock({ blockNumber: block }), ctx.client.getBlock({ blockNumber: head }),
  ])
  if (indexed.hash !== meta.hash || indexed.timestamp !== BigInt(meta.timestamp)) {
    throw new SafenetError("the history subgraph block does not match the chain")
  }
  if (latest.timestamp - indexed.timestamp > BigInt(SUBGRAPH_STALE_AFTER_SECONDS)) {
    throw new SafenetError("the history subgraph is stale (more than 15 minutes behind the requested chain head)")
  }
  return { block, time: indexed.timestamp, at: `block: { hash: "${meta.hash}" }` }
}

/** Exhaust the pinned entity query and reject missing, duplicated or non-progressing pages. */
async function pages<T extends { id: string }>(
  ctx: Context, endpoint: string, entity: string, fields: string, at: string,
  filter: string, schema: z.ZodType<T>, expected: number,
): Promise<T[]> {
  const rows = new Map<string, T>()
  let cursor = ""
  for (;;) {
    const result = await query(ctx, endpoint, `{ ${entity}(first: ${PAGE}, orderBy: id, orderDirection: asc, ${at}, where: { id_gt: "${cursor}" ${filter} }) { ${fields} } }`)
    const parsed = z.object({ [entity]: z.array(schema).max(PAGE) }).safeParse(result)
    if (!parsed.success) throw new SafenetError("the history subgraph returned an incomplete or malformed page")
    const page = parsed.data[entity]!
    for (const row of page) {
      if (row.id <= cursor) throw new SafenetError("the history subgraph pagination did not advance")
      if (rows.has(row.id)) throw new SafenetError("the history subgraph returned duplicate ids")
      rows.set(row.id, row)
    }
    if (rows.size > expected) throw new SafenetError("the history subgraph count does not match its rows")
    if (page.length < PAGE) break
    cursor = page.at(-1)!.id
    if (page.some((row) => row.id > cursor)) throw new SafenetError("the history subgraph page is not ordered")
  }
  if (rows.size !== expected) throw new SafenetError("the history subgraph is partial: rows are missing")
  return [...rows.values()]
}

/** Read all account claims and verify their count, payment sum and block boundaries. */
export async function indexedClaims(ctx: Context, account: Address, head: bigint) {
  return withSubgraphFallback(subgraphUrl(ctx), async (endpoint) => {
    const snap = await snapshot(ctx, endpoint, head)
    const totals = z.object({ rewardAccount: z.object({ claimCount: count, cumulativeClaimed: uint }).nullable() })
      .safeParse(await query(ctx, endpoint, `{ rewardAccount(id: "${account.toLowerCase()}", ${snap.at}) { claimCount cumulativeClaimed } }`))
    if (!totals.success) throw new SafenetError("the history subgraph account totals are incomplete")
    const expected = totals.data.rewardAccount
    const rows = await pages(ctx, endpoint, "rewardClaims", "id account amount blockNumber timestamp transactionHash", snap.at,
      `account: "${account.toLowerCase()}"`, claimSchema, expected?.claimCount ?? 0)
    if (rows.some((r) => r.account !== account.toLowerCase() || r.blockNumber < CONTRACTS.merkleDrop.deployBlock ||
      r.blockNumber > snap.block || r.timestamp > snap.time) ||
      rows.reduce((sum, r) => sum + r.amount, 0n) !== (expected?.cumulativeClaimed ?? 0n)) {
      throw new SafenetError("the history subgraph claims do not match its account or block boundaries")
    }
    return { ...snap, rows }
  })
}

/** Read every withdrawal, including claimed rows, and verify lifecycle fields and pending totals. */
export async function indexedWithdrawals(ctx: Context, head: bigint) {
  return withSubgraphFallback(subgraphUrl(ctx), async (endpoint) => {
    const snap = await snapshot(ctx, endpoint, head)
    const totals = z.object({ network: z.object({ withdrawalCount: count, pendingWithdrawals: uint }) })
      .safeParse(await query(ctx, endpoint, `{ network(id: "1", ${snap.at}) { withdrawalCount pendingWithdrawals } }`))
    if (!totals.success) throw new SafenetError("the history subgraph network totals are incomplete")
    const rows = await pages(ctx, endpoint, "withdrawals",
      "id staker amount claimed initiatedAtBlock initiatedAtTimestamp initiatedTxHash claimedAtBlock claimedAtTimestamp claimedTxHash",
      snap.at, "", withdrawalSchema, totals.data.network.withdrawalCount)
    if (rows.some((r) => r.initiatedAtBlock < CONTRACTS.staking.deployBlock || r.initiatedAtBlock > snap.block ||
      r.initiatedAtTimestamp > snap.time || (r.claimed
        ? r.claimedAtBlock === null || r.claimedAtTimestamp === null || r.claimedTxHash === null ||
          r.claimedAtBlock < r.initiatedAtBlock || r.claimedAtBlock > snap.block ||
          r.claimedAtTimestamp < r.initiatedAtTimestamp || r.claimedAtTimestamp > snap.time
        : r.claimedAtBlock !== null || r.claimedAtTimestamp !== null || r.claimedTxHash !== null)) ||
      rows.filter((r) => !r.claimed).reduce((sum, r) => sum + r.amount, 0n) !== totals.data.network.pendingWithdrawals) {
      throw new SafenetError("the history subgraph withdrawals do not match its totals or block boundaries")
    }
    return { ...snap, rows }
  })
}

/** Describe the indexed coverage and the RPC tail that makes the result complete at its captured head. */
export function indexedSource(block: bigint, head: bigint): string {
  if (block === head) return `subgraph: safenet-mainnet; complete at chain block ${head} (index lag 0 blocks)`
  return `subgraph: safenet-mainnet through block ${block}; chain: logs from ${block + 1n} through ${head}; complete at block ${head} (index lag ${head - block} blocks, filled by RPC)`
}

/** Both attempts failed: never return an empty or stale document as success. */
export function historyUnavailable(indexError: unknown, scanError: unknown): SafenetError {
  const reason = indexError instanceof SafenetError ? indexError.message : "the indexed history or its RPC tail is unavailable"
  return new SafenetError(`History unavailable: ${reason}; the full RPC log scan also failed. No partial results returned. ` +
    "Retry later or configure SUBGRAPH_URL_MAINNET and an RPC that serves the required logs; providers differ in range, rate and retention limits", { cause: scanError })
}

/** Read-only history is supported on Ethereum Mainnet only, including an explicit RPC override. */
export async function requireHistoryMainnet(ctx: Context): Promise<void> {
  if (await ctx.client.getChainId() !== 1) throw new SafenetError("History requires an Ethereum Mainnet RPC (chain id 1)")
}
