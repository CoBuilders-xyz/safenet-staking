/** `safenet withdrawals list`: pending withdrawals, network-wide or for one staker. */
import type { Address } from "viem"
import { CONTRACTS, indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { figure, type Figure } from "./figure.js"
import { scanLogs } from "./scan.js"

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
  const { client } = ctx
  const staking = CONTRACTS.staking.address
  const block = await client.getBlockNumber()
  const from = CONTRACTS.staking.deployBlock
  const [total, initiated, claimed] = await Promise.all([
    client.readContract({ address: staking, abi: stakingAbi, functionName: "totalPendingWithdrawals", blockNumber: block }),
    scanLogs(ctx, { address: staking, event: indexedEvent("staking", "WithdrawalInitiated"), fromBlock: from, toBlock: block }),
    scanLogs(ctx, { address: staking, event: indexedEvent("staking", "WithdrawalClaimed"), fromBlock: from, toBlock: block }),
  ])
  const claimedIds = new Set(claimed.map((l) => String(l.args.withdrawalId)))
  const open = initiated.filter((l) => !claimedIds.has(String(l.args.withdrawalId)))
  const openSum = open.reduce((a, l) => a + (l.args.amount ?? 0n), 0n)
  return {
    scope: "network",
    block,
    total: figure(total, "chain: Staking.totalPendingWithdrawals()"),
    count: figure(
      open.length,
      `chain: WithdrawalInitiated logs without a WithdrawalClaimed for the same id, from block ${from}`,
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
