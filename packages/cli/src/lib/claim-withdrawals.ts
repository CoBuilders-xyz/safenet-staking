/**
 * `safenet withdrawals claim <id | --all>`.
 *
 * `claimWithdrawal()` takes no id: it pays the oldest withdrawal in the caller's queue, which
 * core records as proven on a fork. So a withdrawal is claimed by claiming every one before it
 * too, one transaction each, the way the web interface batches them. Whether each one is past
 * its delay is read from the contract, never assumed.
 */
import { parseEventLogs, type Address } from "viem"
import { CONTRACTS, indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { figure, type Figure } from "./figure.js"
import { actor } from "./stake.js"
import {
  amount, call, createRunner, type Amount, type WriteMode, type WriteOptions, type WriteResultBase,
} from "./transactions.js"

const STAKING = CONTRACTS.staking.address

export interface QueuedWithdrawal {
  readonly id: bigint
  readonly amount: Amount
  readonly claimableAt: Date
  /** claimableAt is at or before the time of the block read. */
  readonly claimable: boolean
}

/** A queue longer than this is not a queue this tool should walk one read at a time. */
const MAX_QUEUE = 500

/** The staker's pending withdrawals, oldest first, by walking the contract's linked list. */
export async function readQueue(
  ctx: Context,
  staker: Address,
  block: { number: bigint; timestamp: bigint },
): Promise<QueuedWithdrawal[]> {
  const read = { address: STAKING, abi: stakingAbi, blockNumber: block.number } as const
  const [head] = await ctx.client.readContract({ ...read, functionName: "withdrawalQueues", args: [staker] })
  const queue: QueuedWithdrawal[] = []
  for (let id = head; id !== 0n;) {
    if (queue.length >= MAX_QUEUE) {
      throw new SafenetError(`${staker} has more than ${MAX_QUEUE} pending withdrawals, more than this tool reads`)
    }
    const [wei, claimableAt, , next] = await ctx.client.readContract({
      ...read, functionName: "withdrawalNodes", args: [staker, id],
    })
    queue.push({
      id,
      amount: amount(wei),
      claimableAt: new Date(Number(claimableAt) * 1000),
      claimable: claimableAt <= block.timestamp,
    })
    id = next
  }
  return queue
}

export interface ClaimedWithdrawal {
  readonly id: bigint
  readonly amount: Amount
}

export interface ClaimWithdrawalsResult extends WriteResultBase {
  readonly operation: "withdrawals claim"
  readonly blockTime: Date
  readonly requested: bigint | "all"
  /** The queue before the claim. */
  readonly queue: Figure<readonly QueuedWithdrawal[]>
  /**
   * What was paid: from each receipt's WithdrawalClaimed log, or in a dry run, the withdrawals
   * the transactions would pay.
   */
  readonly claimed: readonly ClaimedWithdrawal[]
  readonly total: Amount
  /** Every withdrawal still in its delay, which this run leaves in the queue. */
  readonly notYetClaimable: readonly QueuedWithdrawal[]
}

/** "2026-10-07 03:20 UTC", as the CLI prints times. A sentence from here reaches the user as it is. */
const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`

/** The withdrawals to pay, oldest first, or the sentence that says why none can be. */
function select(staker: Address, queue: readonly QueuedWithdrawal[], requested: bigint | "all"): QueuedWithdrawal[] {
  if (queue.length === 0) throw new SafenetError(`${staker} has no pending withdrawal to claim`)
  const ready = queue.findIndex((w) => !w.claimable)
  const claimable = ready === -1 ? [...queue] : queue.slice(0, ready)
  if (requested === "all") {
    const oldest = queue[0]!
    if (claimable.length === 0) {
      throw new SafenetError(
        `None of ${staker}'s ${queue.length} pending withdrawal${queue.length === 1 ? " is" : "s is"} claimable yet; ` +
          `the oldest, id ${oldest.id}, is claimable at ${when(oldest.claimableAt)}`,
      )
    }
    return claimable
  }
  const index = queue.findIndex((w) => w.id === requested)
  if (index === -1) {
    throw new SafenetError(
      `${staker} has no pending withdrawal with id ${requested}; its pending ids are ${queue.map((w) => w.id).join(", ")}`,
    )
  }
  if (index >= claimable.length) {
    const target = queue[index]!
    const blocking = queue[claimable.length]!
    throw new SafenetError(
      blocking.id === target.id
        ? `Withdrawal ${target.id} is not claimable yet: it is in its delay until ${when(target.claimableAt)}`
        : `Withdrawal ${target.id} is not claimable yet: claimWithdrawal() pays the oldest first, and withdrawal ` +
            `${blocking.id} before it is in its delay until ${when(blocking.claimableAt)}`,
    )
  }
  return queue.slice(0, index + 1)
}

export async function claimWithdrawals(
  ctx: Context,
  mode: WriteMode,
  requested: bigint | "all",
  options: WriteOptions = {},
): Promise<ClaimWithdrawalsResult> {
  const from = actor(mode)
  const block = await ctx.client.getBlock()
  const queue = await readQueue(ctx, from, block)
  const chosen = select(from, queue, requested)

  const runner = await createRunner(ctx, mode, options)
  const claimedEvent = indexedEvent("staking", "WithdrawalClaimed")
  const claimed: ClaimedWithdrawal[] = []
  for (const expected of chosen) {
    const { logs } = await runner.run(call("Staking", STAKING, stakingAbi, "claimWithdrawal", []))
    if (mode.dryRun) {
      claimed.push({ id: expected.id, amount: expected.amount })
      continue
    }
    for (const log of parseEventLogs({ abi: [claimedEvent], logs: [...logs], args: { staker: from } })) {
      claimed.push({ id: log.args.withdrawalId, amount: amount(log.args.amount) })
    }
  }
  return {
    operation: "withdrawals claim",
    dryRun: mode.dryRun,
    from,
    block: block.number,
    blockTime: new Date(Number(block.timestamp) * 1000),
    requested,
    queue: figure(queue, "chain: Staking.withdrawalQueues(staker) and withdrawalNodes(staker, id)"),
    claimed,
    total: amount(claimed.reduce((sum, w) => sum + w.amount.wei, 0n)),
    notYetClaimable: queue.filter((w) => !w.claimable),
    steps: runner.steps,
  }
}
