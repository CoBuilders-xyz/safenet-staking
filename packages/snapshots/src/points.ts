/**
 * The instant a snapshot describes: one Mainnet block, one Gnosis block, and the commit that
 * last wrote each of SEF's files.
 *
 * The Mainnet block is a few confirmations below the lower of the RPC's head and the Mainnet
 * subgraph's head, so both can answer it. The subgraph is then asked for it by the hash the RPC
 * gave, which fails when the subgraph's chain does not hold that block: a subgraph on another
 * fork than the RPC would describe another chain. The Gnosis block is the Gnosis subgraph's
 * head, by its hash; no Gnosis RPC is read. A subgraph with indexing errors, or one whose head
 * is older than core's staleness threshold, stops the day.
 */
import { SEF_DATA, SUBGRAPH_STALE_AFTER_SECONDS, SUBGRAPH_ENDPOINTS } from "@cobuilders/safenet-core"
import { SnapshotError } from "./errors.js"
import type { ChainPoint, Points } from "./dataset.js"
import type { SefPin } from "./pinned.js"
import { meta, type Query } from "./subgraph.js"

/** Blocks below the head, so a reorg at the tip does not move the pinned block. */
export const CONFIRMATIONS = 12n

/** SEF's files the snapshot copies, with the commits API URL that names the last commit of each. */
export const SEF_FILES: readonly { readonly path: string; readonly commits: string }[] = [
  { path: "validator-info.json", commits: SEF_DATA.validatorInfoCommits },
  { path: "network-info.json", commits: SEF_DATA.networkInfoCommits },
  { path: "rewards/latest.json", commits: SEF_DATA.rewardsLatestCommits },
]

export interface PointsIo {
  readonly mainnet: Query
  readonly gnosis: Query
  /** The Mainnet RPC: its head, and the hash and timestamp of a block. */
  readonly rpc: {
    readonly head: () => Promise<bigint>
    readonly block: (n: bigint) => Promise<{ hash: string; timestamp: bigint }>
  }
  /** The last commit that wrote a file, from the GitHub commits API URL in SEF_DATA. */
  readonly lastCommit: (url: string) => Promise<{ sha: string; publishedAt: Date }>
  readonly now: Date
}

/** YYYY-MM-DD, the UTC day of a unix timestamp in seconds. */
export function utcDay(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toISOString().slice(0, 10)
}

async function head(query: Query, chain: string, now: Date) {
  const m = await meta(query)
  if (m.hasIndexingErrors) throw new SnapshotError(`the ${chain} subgraph reports indexing errors`)
  const age = BigInt(Math.floor(now.getTime() / 1000)) - m.block.timestamp
  if (age > BigInt(SUBGRAPH_STALE_AFTER_SECONDS)) {
    throw new SnapshotError(`the ${chain} subgraph's head, block ${m.block.number}, is ${age} s old, past the ${SUBGRAPH_STALE_AFTER_SECONDS} s core allows`)
  }
  return m
}

export async function choosePoints(io: PointsIo): Promise<Points> {
  const [mainnetHead, gnosisHead, rpcHead] = await Promise.all([
    head(io.mainnet, "Mainnet", io.now),
    head(io.gnosis, "Gnosis", io.now),
    io.rpc.head(),
  ])
  const B = (mainnetHead.block.number < rpcHead ? mainnetHead.block.number : rpcHead) - CONFIRMATIONS
  const [rpcB, ...commits] = await Promise.all([io.rpc.block(B), ...SEF_FILES.map((f) => io.lastCommit(f.commits))])
  const [atB, atG] = await Promise.all([meta(io.mainnet, rpcB.hash), meta(io.gnosis, gnosisHead.block.hash)])
  if (atB.block.number !== B || atB.block.timestamp !== rpcB.timestamp) {
    throw new SnapshotError(`the Mainnet subgraph places the RPC's block ${B} at ${atB.block.number}, ` +
      `timestamp ${atB.block.timestamp} against ${rpcB.timestamp}`)
  }
  const point = (m: typeof atB, endpoint: string): ChainPoint => ({
    block: m.block.number, hash: m.block.hash, timestamp: m.block.timestamp, deployment: m.deployment, endpoint,
  })
  const sef: SefPin[] = SEF_FILES.map((f, i) => ({ path: f.path, commit: commits[i]!.sha, publishedAt: commits[i]!.publishedAt }))
  return {
    day: utcDay(rpcB.timestamp),
    mainnet: point(atB, SUBGRAPH_ENDPOINTS.mainnet),
    gnosis: point(atG, SUBGRAPH_ENDPOINTS.gnosis),
    sef,
  }
}
