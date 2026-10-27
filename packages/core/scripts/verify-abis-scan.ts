/**
 * The per-event log scans behind verify:abis, and the anchor of a closed programme, taking the
 * client as an argument so the unit tests can hand them a mocked getLogs and getBlock. No network
 * here, and no constant from the registry: the programme calendar is an argument too.
 */
import type { AbiEvent, Address } from "viem"
import type { ChainKey } from "../src/chains.js"
import type { ContractRef } from "../src/contracts.js"
import { utcDayMs, type Programme, type UtcDay } from "../src/sef.js"
import { blockAtTimestamp } from "../src/parity/blocks.js"

/**
 * First window scanned back from the head, per chain. Gnosis blocks are ~5s, Mainnet ~12s, so
 * 2,000 Gnosis blocks are about 2.8 hours and 5,000 Mainnet blocks about 17 hours.
 */
export const WINDOW: Record<ChainKey, bigint> = { mainnet: 5_000n, gnosis: 2_000n }

/**
 * How far back the fast mode widens before it gives up on an event. 200,000 Gnosis blocks are
 * about 11.5 days and 100,000 Mainnet blocks about 14 days. A high-frequency event the contract
 * has not emitted for that long is not high-frequency, or its signature is wrong.
 */
export const CEILING: Record<ChainKey, bigint> = { mainnet: 100_000n, gnosis: 200_000n }

/** The one client method the scans need. A viem PublicClient satisfies it. */
export interface LogsClient {
  getLogs(args: {
    address: Address
    event?: AbiEvent
    fromBlock: bigint
    toBlock: bigint
  }): Promise<readonly { blockNumber: bigint | null }[]>
}

/** The one client method the anchor search needs. A viem PublicClient satisfies it. */
export interface BlocksClient {
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>
}

type Log = { blockNumber: bigint | null }

/**
 * Logs of the first chunk of [from, to] that has any, walking oldest first ("asc") or newest
 * first ("desc"). Chunked, because a deep scan spans millions of blocks and providers cap the
 * range. A single unchunked request over that span fails, and every rare signature would then go
 * unproven. A failed request shrinks the chunk, down to 1,000 blocks, before it gives up.
 */
export async function getLogsChunked(
  client: LogsClient,
  filter: { address: Address; event?: AbiEvent },
  from: bigint,
  to: bigint,
  order: "asc" | "desc",
): Promise<readonly Log[]> {
  let chunk = 50_000n
  if (order === "asc") {
    let cursor = from < 0n ? 0n : from
    while (cursor <= to) {
      const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n
      try {
        const logs = await client.getLogs({ ...filter, fromBlock: cursor, toBlock: end })
        if (logs.length > 0) return logs
        cursor = end + 1n
      } catch (err) {
        if (chunk <= 1_000n) throw err
        chunk /= 4n
      }
    }
    return []
  }
  const floor = from < 0n ? 0n : from
  let cursor = to
  while (cursor >= floor) {
    const start = cursor - chunk + 1n < floor ? floor : cursor - chunk + 1n
    try {
      const logs = await client.getLogs({ ...filter, fromBlock: start, toBlock: cursor })
      if (logs.length > 0) return logs
      cursor = start - 1n
    } catch (err) {
      if (chunk <= 1_000n) throw err
      chunk /= 4n
    }
  }
  return []
}

/**
 * The newest logs within `ceiling` blocks of `latest`. Scans `window` blocks back from the head,
 * then widens backwards in doubling steps (window, 2×window, 4×window, …) up to the ceiling, and
 * stops at the first step that returns a log. Each step scans only blocks the previous one did
 * not. Without `event` it returns any log the address emitted.
 */
export async function newestLogs(
  client: LogsClient,
  filter: { address: Address; event?: AbiEvent },
  latest: bigint,
  window: bigint,
  ceiling: bigint,
): Promise<{ logs: readonly Log[]; lastSeen?: bigint; depth: bigint }> {
  let newest = latest
  let depth = window < ceiling ? window : ceiling
  for (;;) {
    const logs = await getLogsChunked(client, filter, latest - depth, newest, "desc")
    if (logs.length > 0) {
      let max = 0n
      for (const l of logs) if (l.blockNumber !== null && l.blockNumber > max) max = l.blockNumber
      return { logs, lastSeen: latest - max, depth }
    }
    if (depth >= ceiling || latest - depth <= 0n) return { logs: [], depth }
    newest = latest - depth - 1n
    depth = depth * 2n > ceiling ? ceiling : depth * 2n
  }
}

/**
 * match        the event was emitted within the ceiling.
 * match (programme ended)
 *              the same, for a contract of a closed programme, counted back from the
 *              programme's last block instead of the head.
 * NO MATCH     the contract emitted other logs within the ceiling, never this topic0. The
 *              signature is wrong, or the event is not high-frequency.
 * NO ACTIVITY  the contract emitted no log of any kind within the ceiling. The signature is
 *              untested: the contract is idle, or it was redeployed to a new address.
 */
export type Status = "match" | "match (programme ended)" | "NO MATCH" | "NO ACTIVITY"

export interface RecentScan {
  status: Status
  logs: number
  /** Blocks between the head, or the anchor, and the newest log of this event. Set only on a match. */
  lastSeen?: bigint | undefined
  /** How many blocks back from the head, or the anchor, the scan reached. */
  depth: bigint
}

/** The fast mode for one event: recent window, widened up to the ceiling when it is quiet. */
export async function scanRecent(
  client: LogsClient,
  address: Address,
  event: AbiEvent,
  latest: bigint,
  window: bigint,
  ceiling: bigint,
): Promise<RecentScan> {
  // Filtering by `event` makes viem derive topic0 from OUR signature. If the deployed contract
  // no longer emits it, the result is empty. That is the test.
  const found = await newestLogs(client, { address, event }, latest, window, ceiling)
  if (found.logs.length > 0) {
    return { status: "match", logs: found.logs.length, lastSeen: found.lastSeen, depth: found.depth }
  }
  // Nothing within the ceiling. Ask whether the contract emitted anything at all, so a wrong
  // signature on a live contract reads differently from a contract that went quiet.
  const any = await newestLogs(client, { address }, latest, window, ceiling)
  return { status: any.logs.length > 0 ? "NO MATCH" : "NO ACTIVITY", logs: 0, depth: found.depth }
}

/** Where a contract's closed programme ends, and the block to search for that end from. */
export interface Close {
  programme: Programme
  /** Midnight UTC of the day the programme is closed from. */
  closedAt: Date
  /** A block before the close: the deploy block, else the scan floor. */
  floor: bigint
}

/**
 * Whether verify:abis scans a contract back from its programme's end instead of the head: only
 * when the contract names a programme and `closedFrom`, the calendar of PROGRAMME_CLOSED_FROM in
 * sef.ts, closes it. Throws when such a contract gives no block to search the end from.
 */
export function closeOf(
  ref: ContractRef,
  closedFrom: Readonly<Partial<Record<Programme, UtcDay>>>,
): Close | undefined {
  if (ref.programme === undefined) return undefined
  const day = closedFrom[ref.programme]
  if (day === undefined) return undefined
  const floor = ref.deployBlock ?? ref.startBlock
  if (floor === undefined) {
    throw new Error(
      `${ref.address} belongs to the closed ${ref.programme} programme, and contracts.ts gives no ` +
      `block to search its end from.`,
    )
  }
  return { programme: ref.programme, closedAt: new Date(utcDayMs(day)), floor }
}

/**
 * The last block before `closedAt`, the instant a programme closed: the newest block a closed
 * programme's contracts can hold a log of it in. A binary search on block timestamps, from
 * `floor`, a block known to be earlier such as the deploy block, up to `margin` blocks below the
 * head. Found at run time, so no block number is written down for it.
 *
 * Not up to the head itself: a public RPC pool spreads requests over backends, and one a block
 * behind answers null for a block another just reported as the head, which viem throws as
 * BlockNotFoundError. A block `margin` behind is settled on every backend, and the close of a
 * programme that has ended lies far further back. A close within `margin` of the head is
 * refused, not clamped.
 */
export async function lastBlockBefore(
  client: BlocksClient,
  closedAt: Date,
  floor: bigint,
  latest: bigint,
  margin: bigint,
): Promise<bigint> {
  const hi = latest - margin
  try {
    return await blockAtTimestamp({
      timestampOf: async (blockNumber) => (await client.getBlock({ blockNumber })).timestamp,
      lo: floor,
      hi,
      // The last block stamped strictly before the instant. Timestamps are whole seconds.
      target: BigInt(Math.ceil(closedAt.getTime() / 1000)) - 1n,
      side: "last",
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `the last block before ${closedAt.toISOString()} is not between blocks ${floor} and ${hi}, ` +
      `${margin} below the head: ${reason}`,
      { cause: err },
    )
  }
}

/**
 * The fast mode for one event of a closed programme. Its contracts will log none of its events
 * again, so a scan back from the head can only report silence once the ceiling passes the close.
 * This is scanRecent anchored at the programme's last block instead: the same window, doubling
 * and ceiling, with lastSeen and depth counted back from the anchor. NO MATCH and NO ACTIVITY
 * keep their meaning, within the ceiling before the anchor.
 */
export async function scanBeforeClose(
  client: LogsClient,
  address: Address,
  event: AbiEvent,
  anchor: bigint,
  window: bigint,
  ceiling: bigint,
): Promise<RecentScan> {
  const scan = await scanRecent(client, address, event, anchor, window, ceiling)
  return scan.status === "match" ? { ...scan, status: "match (programme ended)" } : scan
}

/** The deep mode for one event: from the deploy block, oldest first, stopping at the first log. */
export async function scanFromDeploy(
  client: LogsClient,
  address: Address,
  event: AbiEvent,
  startBlock: bigint,
  latest: bigint,
): Promise<{ logs: number; firstSeen?: bigint | undefined }> {
  const logs = await getLogsChunked(client, { address, event }, startBlock, latest, "asc")
  return { logs: logs.length, firstSeen: logs[0]?.blockNumber ?? undefined }
}
