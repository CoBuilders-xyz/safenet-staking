import type { Command } from "commander"
import { stake, unstake, type StakeResult, type UnstakeResult } from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { formatSafe, formatTime } from "./format.js"
import { addressSchema, parseOptions, safeAmountSchema, stakeSchema, writeSchema } from "./options.js"
import {
  addWriteOptions, approvalText, figureRow, renderFigures, renderProgress, renderSteps, writeHead, type FigureRow,
} from "./write.js"

const safe = (a: { wei: bigint }) => formatSafe(a.wei)

export function renderStake(r: StakeResult): string {
  const rows: FigureRow[] = [
    figureRow("SAFE balance", r.balance, safe),
    figureRow("Allowance", r.allowance, safe),
    ["Approval", approvalText(r.approval), "sent only when the allowance is below the amount"],
    figureRow("Stake before", r.stakeBefore, safe),
  ]
  if (r.stakeAfter) rows.push(figureRow("Stake after", r.stakeAfter, safe))
  return [
    ...writeHead(r, `Stake ${formatSafe(r.amount.wei)} on validator ${r.validator}`),
    "",
    renderFigures(rows),
    "",
    renderSteps(r.steps),
  ].join("\n")
}

export function renderUnstake(r: UnstakeResult): string {
  const rows: FigureRow[] = [figureRow("Stake before", r.stakeBefore, safe)]
  if (r.stakeAfter) rows.push(figureRow("Stake after", r.stakeAfter, safe))
  rows.push(
    ["Withdrawal id", r.withdrawal.id === null ? "known once mined" : String(r.withdrawal.id),
      r.withdrawal.id === null ? "the WithdrawalInitiated log of the transaction" : "chain: WithdrawalInitiated log in the receipt"],
    figureRow("Claimable at", r.withdrawal.claimableAt, formatTime),
  )
  return [
    ...writeHead(r, `Unstake ${formatSafe(r.amount.wei)} from validator ${r.validator}`),
    "",
    renderFigures(rows),
    "",
    renderSteps(r.steps),
    "",
    "The SAFE stays in the staking contract until the delay ends. Then run: safenet withdrawals claim --all",
  ].join("\n")
}

export function registerStake(program: Command, rt: CommandRuntime): void {
  addWriteOptions(
    program
      .command("stake")
      .description("stake SAFE on a validator, approving the staking contract first when the allowance is short")
      .argument("<validator>", "the validator's address")
      .argument("<amount>", "SAFE to stake, such as 100 or 0.5")
      .option("--approve <kind>", "when an approval is needed: exact (the amount) or unlimited", "exact"),
  ).action(async (validator: string, value: string, options: unknown, command: Command) => {
    const globals = rt.globals(command)
    const request = parseOptions(writeSchema, options)
    const { approve } = parseOptions(stakeSchema, options)
    const input = {
      validator: parseOptions(addressSchema, validator),
      amount: parseOptions(safeAmountSchema, value),
      approve,
    }
    const ctx = rt.context(globals)
    const mode = await rt.writeMode(request, ctx)
    rt.emit(globals, await stake(ctx, mode, input, { onProgress: rt.progress(renderProgress), compliance: request.compliance }), renderStake)
  })

  addWriteOptions(
    program
      .command("unstake")
      .description("start a withdrawal of SAFE staked on a validator; it becomes claimable after the delay")
      .argument("<validator>", "the validator's address")
      .argument("<amount>", "SAFE to withdraw, such as 100 or 0.5"),
  ).action(async (validator: string, value: string, options: unknown, command: Command) => {
    const globals = rt.globals(command)
    const request = parseOptions(writeSchema, options)
    const input = {
      validator: parseOptions(addressSchema, validator),
      amount: parseOptions(safeAmountSchema, value),
    }
    const ctx = rt.context(globals)
    const mode = await rt.writeMode(request, ctx)
    rt.emit(globals, await unstake(ctx, mode, input, { onProgress: rt.progress(renderProgress), compliance: request.compliance }), renderUnstake)
  })
}
