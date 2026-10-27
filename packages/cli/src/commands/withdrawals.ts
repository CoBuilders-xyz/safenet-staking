import type { Command } from "commander"
import {
  claimWithdrawals, networkWithdrawals, stakerWithdrawals,
  type ClaimWithdrawalsResult, type NetworkWithdrawals, type StakerWithdrawals,
} from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { formatCount, formatSafe, formatSpan, formatTime, renderTable } from "./format.js"
import { parseOptions, withdrawalClaimSchema, withdrawalsListSchema, writeSchema } from "./options.js"
import { addWriteOptions, renderProgress, renderSteps, writeHead } from "./write.js"

export function renderNetworkWithdrawals(w: NetworkWithdrawals): string {
  const rows: [string, string, string][] = [
    ["Total pending", formatSafe(w.total.value), w.total.source],
    ["Count pending", formatCount(w.count.value), w.count.source],
    ["History", `${formatCount(w.initiated)} initiated, ${formatCount(w.claimed)} claimed`,
      "chain: WithdrawalInitiated and WithdrawalClaimed logs"],
  ]
  const check = w.logsMatchChain
    ? `Check: the ${formatCount(w.count.value)} open withdrawals in the logs sum to the total on chain.`
    : `Check failed: the open withdrawals in the logs sum to ${formatSafe(w.openSum)}, but the chain ` +
      `reports ${formatSafe(w.total.value)}. The count may be wrong.`
  return [
    `Pending withdrawals on Ethereum Mainnet, block ${formatCount(w.block)}`,
    "",
    renderTable([{ header: "FIGURE" }, { header: "VALUE" }, { header: "SOURCE" }], rows),
    "",
    check,
  ].join("\n")
}

export function renderStakerWithdrawals(w: StakerWithdrawals): string {
  const items = w.withdrawals.value
  const head = `Pending withdrawals for ${w.address}, Ethereum Mainnet block ${formatCount(w.block)} ` +
    `(${formatTime(w.blockTime)})`
  const source = `Source: ${w.withdrawals.source}.`
  if (items.length === 0) return [head, "", "None.", source].join("\n")
  const table = renderTable(
    [{ header: "#", align: "right" }, { header: "AMOUNT", align: "right" }, { header: "CLAIMABLE AT" }, { header: "STATUS" }],
    items.map((it, i) => [
      String(i + 1),
      formatSafe(it.amount),
      formatTime(it.claimableAt),
      it.claimableNow ? "claimable now" : `in ${formatSpan(w.blockTime, it.claimableAt)}`,
    ]),
  )
  return [
    head,
    "",
    table,
    "",
    `${items.length} pending, ${formatSafe(w.total)} in total. Status is measured against the block time.`,
    source,
  ].join("\n")
}

export function renderClaimWithdrawals(r: ClaimWithdrawalsResult): string {
  const claimedIds = new Set(r.claimed.map((w) => w.id))
  const queue = renderTable(
    [{ header: "ID", align: "right" }, { header: "AMOUNT", align: "right" }, { header: "CLAIMABLE AT" }, { header: "THIS RUN" }],
    r.queue.value.map((w) => [
      String(w.id),
      formatSafe(w.amount.wei),
      formatTime(w.claimableAt),
      claimedIds.has(w.id)
        ? r.dryRun ? "would claim" : "claimed"
        : w.claimable ? "claimable, left for later" : `in its delay, ${formatSpan(r.blockTime, w.claimableAt)} to go`,
    ]),
  )
  const verb = r.dryRun ? "Would claim" : "Claimed"
  const lines = [
    ...writeHead(r, r.requested === "all" ? "Claim every claimable withdrawal" : `Claim withdrawal ${r.requested}`),
    "",
    `Queue before, oldest first, against the block time ${formatTime(r.blockTime)} (${r.queue.source}):`,
    queue,
    "",
    `${verb} ${r.claimed.length} withdrawal${r.claimed.length === 1 ? "" : "s"}, ${formatSafe(r.total.wei)} in total` +
      `${r.dryRun ? "" : ", read from the WithdrawalClaimed logs"}. claimWithdrawal() pays the oldest first.`,
  ]
  if (r.notYetClaimable.length > 0) {
    lines.push(
      `Not yet claimable: ${r.notYetClaimable.map((w) => `id ${w.id} (${formatSafe(w.amount.wei)}, at ${formatTime(w.claimableAt)})`).join(", ")}.`,
    )
  }
  return [...lines, "", renderSteps(r.steps)].join("\n")
}

export function registerWithdrawals(program: Command, rt: CommandRuntime): void {
  const withdrawals = program.command("withdrawals").description("withdrawals waiting out the delay")

  withdrawals
    .command("list")
    .description("pending withdrawals: the network figure and count, or one staker's queue")
    .option("--address <address>", "one staker's pending withdrawals")
    .action(async (options: unknown, command: Command) => {
      const globals = rt.globals(command)
      const { address } = parseOptions(withdrawalsListSchema, options)
      const ctx = rt.context(globals)
      if (address) rt.emit(globals, await stakerWithdrawals(ctx, address), renderStakerWithdrawals)
      else rt.emit(globals, await networkWithdrawals(ctx), renderNetworkWithdrawals)
    })

  addWriteOptions(
    withdrawals
      .command("claim")
      .description("claim withdrawals past their delay; claimWithdrawal() pays the oldest first")
      .argument("[id]", "claim up to and including this withdrawal")
      .option("--all", "claim every withdrawal past its delay"),
  ).action(async (id: string | undefined, options: Record<string, unknown>, command: Command) => {
    const globals = rt.globals(command)
    const request = parseOptions(writeSchema, options)
    const requested = parseOptions(withdrawalClaimSchema, { id, all: options.all })
    const ctx = rt.context(globals)
    const mode = await rt.writeMode(request, ctx)
    rt.emit(
      globals,
      await claimWithdrawals(ctx, mode, requested, { onProgress: rt.progress(renderProgress), compliance: request.compliance }),
      renderClaimWithdrawals,
    )
  })
}
