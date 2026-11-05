/** `safenet withdrawals list`: pending withdrawals, network-wide or for one staker. */
import type { Address } from "viem"
import { CONTRACTS, indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { figure, type Figure } from "./figure.js"
import { scanLogs } from "./scan.js"
import { indexedWithdrawals, indexedSource, historyUnavailable, requireHistoryMainnet } from "./indexed-history.js"
import { SafenetError } from "./errors.js"

export interface NetworkWithdrawals {
  readonly scope: "network"
  readonly block: bigint
  readonly total: Figure<bigint>
  /** Withdrawals initiated and not yet claimed, counted from the logs. */
  readonly count: Figure<number>
  readonly initiated: number
  readonly claimed: number
  /** The sum of the open withdrawals found in the logs. */
  readonly openSum: bigint
  /**
   * Whether the open withdrawals found in the logs sum to the total on chain. When false, the
   * count above is not trustworthy, and the output says so.
   */
  readonly logsMatchChain: boolean
}

export interface PendingWithdrawal {
  readonly amount: bigint
  readonly claimableAt: Date
  /** claimableAt is at or before the timestamp of `block`. */
  readonly claimableNow: boolean
}

export interface StakerWithdrawals {
  readonly scope: "address"
  readonly block: bigint
  readonly blockTime: Date
  readonly address: Address
  readonly withdrawals: Figure<readonly PendingWithdrawal[]>
  readonly total: bigint
}

export async function networkWithdrawals(ctx: Context): Promise<NetworkWithdrawals> {
  await requireHistoryMainnet(ctx)
  const { client } = ctx
  const staking = CONTRACTS.staking.address
  const block = await client.getBlockNumber()
  const from = CONTRACTS.staking.deployBlock
  const total = await client.readContract({ address: staking, abi: stakingAbi, functionName: "totalPendingWithdrawals", blockNumber: block })
  const scan = async (fromBlock: bigint, minChunk?: bigint) => Promise.all([
    scanLogs(ctx, { address: staking, event: indexedEvent("staking", "WithdrawalInitiated"), fromBlock, toBlock: block, ...(minChunk === undefined ? {} : { minChunk }) }),
    scanLogs(ctx, { address: staking, event: indexedEvent("staking", "WithdrawalClaimed"), fromBlock, toBlock: block, ...(minChunk === undefined ? {} : { minChunk }) }),
  ])
  let history: Awaited<ReturnType<typeof scan>>
  try {
    const indexed = await indexedWithdrawals(ctx, block)
    const rows = new Map(indexed.rows.map((r) => [`${r.staker}:${r.id}`, { amount: r.amount, claimed: r.claimed }]))
    const [initiations, claims] = await scan(indexed.block + 1n, 1n)
    for (const log of initiations) {
      const { staker, withdrawalId, amount } = log.args
      if (!staker || withdrawalId === undefined || amount === undefined) throw new SafenetError("The withdrawal initiation log is incomplete")
      const key = `${staker.toLowerCase()}:${withdrawalId}`
      if (rows.has(key)) throw new SafenetError("The withdrawal initiation is duplicated")
      rows.set(key, { amount, claimed: false })
    }
    for (const log of claims) {
      const { staker, withdrawalId, amount } = log.args
      const row = rows.get(`${staker?.toLowerCase()}:${withdrawalId}`)
      if (!row || row.claimed || row.amount !== amount) throw new SafenetError("The withdrawal claim does not match its initiation")
      row.claimed = true
    }
    const open = [...rows.values()].filter((r) => !r.claimed)
    const openSum = open.reduce((sum, r) => sum + r.amount, 0n)
    if (openSum !== total) throw new SafenetError("the indexed withdrawals and RPC tail do not sum to totalPendingWithdrawals on chain")
    return {
      scope: "network", block, total: figure(total, "chain: Staking.totalPendingWithdrawals()"),
      count: figure(open.length, indexedSource(indexed.block, block)), initiated: rows.size,
      claimed: rows.size - open.length, openSum, logsMatchChain: true,
    }
  } catch (indexError) {
    try { history = await scan(from, 1n) } catch { throw historyUnavailable(indexError) }
  }
  const [initiated, claimed] = history
  // Keyed by staker and id. Ids come from one global counter today, but the pair cannot
  // collide even if that changes.
  const key = (l: { args: { staker?: string | undefined; withdrawalId?: bigint | undefined } }) =>
    `${l.args.staker?.toLowerCase()}:${l.args.withdrawalId}`
  const claimedKeys = new Set(claimed.map(key))
  const open = initiated.filter((l) => !claimedKeys.has(key(l)))
  const openSum = open.reduce((a, l) => a + (l.args.amount ?? 0n), 0n)
  return {
    scope: "network",
    block,
    total: figure(total, "chain: Staking.totalPendingWithdrawals()"),
    count: figure(
      open.length,
      `chain: WithdrawalInitiated logs without a WithdrawalClaimed for the same staker and id, from block ${from}`,
    ),
    initiated: initiated.length,
    claimed: claimed.length,
    openSum,
    logsMatchChain: openSum === total,
  }
}

export async function stakerWithdrawals(ctx: Context, address: Address): Promise<StakerWithdrawals> {
  const { client } = ctx
  const block = await client.getBlock()
  const pending = await client.readContract({
    address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "getPendingWithdrawals",
    args: [address], blockNumber: block.number,
  })
  const withdrawals = pending.map((w) => ({
    amount: w.amount,
    claimableAt: new Date(Number(w.claimableAt) * 1000),
    claimableNow: w.claimableAt <= block.timestamp,
  }))
  return {
    scope: "address",
    block: block.number,
    blockTime: new Date(Number(block.timestamp) * 1000),
    address,
    withdrawals: figure(withdrawals, "chain: Staking.getPendingWithdrawals(staker)"),
    total: withdrawals.reduce((a, w) => a + w.amount, 0n),
  }
}
