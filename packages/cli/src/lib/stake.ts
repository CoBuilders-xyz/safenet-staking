/**
 * `safenet stake` and `safenet unstake`, in the shape the web interface sends them: an approval
 * only when the allowance is short (exact by default, as in useApprovalFlow), then
 * `stake(validator, amount)`; and `initiateWithdrawal(validator, amount)`, which starts the delay.
 */
import { maxUint256, parseEventLogs, type Address } from "viem"
import { CONTRACTS, erc20Abi, indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { figure, type Figure } from "./figure.js"
import {
  amount, call, createRunner, type Amount, type Runner, type WriteMode, type WriteOptions, type WriteResultBase,
} from "./transactions.js"

export type ApprovalKind = "exact" | "unlimited"

const STAKING = CONTRACTS.staking.address
const SAFE_TOKEN = CONTRACTS.safeToken.address

/** The address the mode acts for: the signer's, or the one a dry run simulates from. */
export const actor = (mode: WriteMode): Address => (mode.dryRun ? mode.from : mode.signer.address)

/** Refuses a validator the staking contract does not accept, before anything is simulated. */
export async function requireValidator(ctx: Context, validator: Address, blockNumber: bigint): Promise<void> {
  const registered = await ctx.client.readContract({
    address: STAKING, abi: stakingAbi, functionName: "isValidator", args: [validator], blockNumber,
  })
  if (!registered) throw new SafenetError(`${validator} is not a registered validator on the staking contract`)
}

export async function readStake(ctx: Context, staker: Address, validator: Address, blockNumber?: bigint | undefined): Promise<Figure<Amount>> {
  const wei = await ctx.client.readContract({
    address: STAKING, abi: stakingAbi, functionName: "stakes", args: [staker, validator], blockNumber,
  })
  return figure(amount(wei), "chain: Staking.stakes(staker, validator)")
}

export interface Approval {
  readonly kind: ApprovalKind
  readonly amount: Amount
}

/**
 * The approval, when the allowance is short, then the stake. Shared with claim-and-stake, which
 * runs it after its claim on the same runner.
 */
export async function runStake(
  ctx: Context,
  runner: Runner,
  input: { validator: Address; amount: bigint; approve: ApprovalKind; blockNumber?: bigint | undefined },
): Promise<{ allowance: Figure<Amount>; approval: Approval | null }> {
  const allowance = await ctx.client.readContract({
    address: SAFE_TOKEN, abi: erc20Abi, functionName: "allowance", args: [runner.from, STAKING], blockNumber: input.blockNumber,
  })
  let approval: Approval | null = null
  if (allowance < input.amount) {
    const approved = input.approve === "unlimited" ? maxUint256 : input.amount
    await runner.run(call("SAFE token", SAFE_TOKEN, erc20Abi, "approve", [STAKING, approved]))
    approval = { kind: input.approve, amount: amount(approved) }
  }
  await runner.run(call("Staking", STAKING, stakingAbi, "stake", [input.validator, input.amount]))
  return { allowance: figure(amount(allowance), "chain: SAFE.allowance(staker, Staking)"), approval }
}

export interface StakeResult extends WriteResultBase {
  readonly operation: "stake"
  readonly validator: Address
  readonly amount: Amount
  readonly balance: Figure<Amount>
  readonly allowance: Figure<Amount>
  /** The approval sent first, or null when the allowance already covered the amount. */
  readonly approval: Approval | null
  readonly stakeBefore: Figure<Amount>
  /** Read after the stake confirmed. Null in a dry run. */
  readonly stakeAfter: Figure<Amount> | null
}

export async function stake(
  ctx: Context,
  mode: WriteMode,
  input: { validator: Address; amount: bigint; approve: ApprovalKind },
  options: WriteOptions = {},
): Promise<StakeResult> {
  const from = actor(mode)
  const block = await ctx.client.getBlockNumber()
  await requireValidator(ctx, input.validator, block)
  const [balance, stakeBefore] = await Promise.all([
    ctx.client.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [from], blockNumber: block }),
    readStake(ctx, from, input.validator, block),
  ])
  if (balance < input.amount) {
    throw new SafenetError(
      `${from} holds ${amount(balance).safe} SAFE, less than the ${amount(input.amount).safe} SAFE to stake`,
    )
  }
  const runner = await createRunner(ctx, mode, options)
  const { allowance, approval } = await runStake(ctx, runner, { ...input, blockNumber: block })
  return {
    operation: "stake",
    dryRun: mode.dryRun,
    from,
    block,
    validator: input.validator,
    amount: amount(input.amount),
    balance: figure(amount(balance), "chain: SAFE.balanceOf(staker)"),
    allowance,
    approval,
    stakeBefore,
    stakeAfter: mode.dryRun ? null : await readStake(ctx, from, input.validator),
    steps: runner.steps,
  }
}

export interface UnstakeResult extends WriteResultBase {
  readonly operation: "unstake"
  readonly validator: Address
  readonly amount: Amount
  readonly stakeBefore: Figure<Amount>
  readonly stakeAfter: Figure<Amount> | null
  /** The withdrawal the transaction opened. Its id is only known once it is mined. */
  readonly withdrawal: {
    readonly id: bigint | null
    readonly claimableAt: Figure<Date>
  }
}

export async function unstake(
  ctx: Context,
  mode: WriteMode,
  input: { validator: Address; amount: bigint },
  options: WriteOptions = {},
): Promise<UnstakeResult> {
  const from = actor(mode)
  const latest = await ctx.client.getBlock()
  const block = latest.number
  const [stakeBefore, delay] = await Promise.all([
    readStake(ctx, from, input.validator, block),
    ctx.client.readContract({ address: STAKING, abi: stakingAbi, functionName: "withdrawDelay", blockNumber: block }),
  ])
  if (stakeBefore.value.wei < input.amount) {
    throw new SafenetError(
      `${from} has ${stakeBefore.value.safe} SAFE staked on ${input.validator}, less than the ` +
        `${amount(input.amount).safe} SAFE to unstake`,
    )
  }
  const runner = await createRunner(ctx, mode, options)
  const { logs } = await runner.run(
    call("Staking", STAKING, stakingAbi, "initiateWithdrawal", [input.validator, input.amount]),
  )

  let withdrawal: UnstakeResult["withdrawal"]
  const [initiated] = parseEventLogs({
    abi: [indexedEvent("staking", "WithdrawalInitiated")],
    logs: [...logs],
    args: { staker: from },
  })
  if (!mode.dryRun && initiated) {
    const id = initiated.args.withdrawalId
    const node = await ctx.client.readContract({
      address: STAKING, abi: stakingAbi, functionName: "withdrawalNodes", args: [from, id],
    })
    withdrawal = {
      id,
      claimableAt: figure(new Date(Number(node[1]) * 1000), "chain: Staking.withdrawalNodes(staker, id)"),
    }
  } else {
    withdrawal = {
      id: null,
      claimableAt: figure(
        new Date(Number(latest.timestamp + delay) * 1000),
        "the read block's time plus Staking.withdrawDelay(), the earliest it can be",
      ),
    }
  }
  return {
    operation: "unstake",
    dryRun: mode.dryRun,
    from,
    block,
    validator: input.validator,
    amount: amount(input.amount),
    stakeBefore,
    stakeAfter: mode.dryRun ? null : await readStake(ctx, from, input.validator),
    withdrawal,
    steps: runner.steps,
  }
}
