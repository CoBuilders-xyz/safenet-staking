import type { Command } from "commander"
import { checkRewards, rewardsHistory, type RewardsCheck, type RewardsHistory } from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { formatCount, formatSafe, formatTime, renderTable } from "./format.js"
import { addressSchema, historySchema, parseOptions } from "./options.js"

export function renderRewardsCheck(r: RewardsCheck): string {
  const head = `Rewards for ${r.address}, Ethereum Mainnet block ${formatCount(r.block)}`
  if (!r.earned) {
    const lines = [
      head,
      "",
      "Never earned: SEF published no reward proof for this address (the file is a 404).",
      `Claimed on chain: ${formatSafe(r.claimed.value)} (${r.claimed.source}).`,
    ]
    return lines.join("\n")
  }
  const rows: [string, string, string][] = [
    ["Earned to date", formatSafe(r.cumulative.value ?? 0n), r.cumulative.source],
    ["Claimed", formatSafe(r.claimed.value), r.claimed.source],
    ["Claimable", formatSafe(r.claimable.value ?? 0n), r.claimable.source],
    ["Can claim", r.canClaim.value ? "yes" : "no", r.canClaim.source],
  ]
  if (r.kycAmount.value !== null) {
    rows.push(["kycAmount", formatSafe(r.kycAmount.value), r.kycAmount.source])
  }
  if (r.kycPassed.value !== null) {
    rows.push(["Compliance checked", r.kycPassed.value ? "yes" : "no", r.kycPassed.source])
  }
  if (r.kycAmount.value !== null) {
    rows.push(["Held pending compliance", formatSafe(r.heldPendingCompliance), "kycAmount, unless kyc is true"])
  }
  if (r.root) {
    rows.push(["Merkle root, chain", r.root.onChain.value, r.root.onChain.source])
    rows.push(["Merkle root, proof", r.root.proof.value, r.root.proof.source])
  }
  const root = r.root?.status === "stale proof"
    ? "Proof: stale proof. Its root is not the root on chain, so the claimable figure comes from an outdated file."
    : "Proof: match. Its root is the root on chain."
  return [
    head,
    "",
    renderTable([{ header: "FIGURE" }, { header: "VALUE" }, { header: "SOURCE" }], rows),
    "",
    root,
  ].join("\n")
}

export function renderRewardsHistory(h: RewardsHistory): string {
  const head = `Reward claims by ${h.address}, Ethereum Mainnet block ${formatCount(h.block)}`
  const source = `Source: ${h.source}.`
  if (h.count === 0) return [head, "", "None.", source].join("\n")
  const table = renderTable(
    [{ header: "TIME" }, { header: "BLOCK", align: "right" }, { header: "AMOUNT", align: "right" }, { header: "TRANSACTION" }],
    h.claims.map((c) => [c.time ? formatTime(c.time) : "", formatCount(c.block), formatSafe(c.amount), c.transaction]),
  )
  const shown = h.limited
    ? `Showing the newest ${h.claims.length} of ${formatCount(h.count)} claims. Use --all for every row.`
    : `${formatCount(h.count)} claim${h.count === 1 ? "" : "s"}, newest first.`
  const check = h.sumMatchesChain
    ? `Claimed in total: ${formatSafe(h.totalClaimed)}, equal to ${h.cumulativeClaimed.source}.`
    : `Check failed: the claims sum to ${formatSafe(h.totalClaimed)}, but ${h.cumulativeClaimed.source} ` +
      `reports ${formatSafe(h.cumulativeClaimed.value)}.`
  return [head, "", table, "", shown, check, source].join("\n")
}

export function registerRewards(program: Command, rt: CommandRuntime): void {
  const rewards = program.command("rewards").description("staking rewards: what an address earned and claimed")

  rewards
    .command("check")
    .description("claimable, earned, claimed and held amounts, and whether the proof is current")
    .argument("<address>", "the staker's address")
    .action(async (address: string, _options: unknown, command: Command) => {
      const globals = rt.globals(command)
      const addr = parseOptions(addressSchema, address)
      rt.emit(globals, await checkRewards(rt.context(globals), addr), renderRewardsCheck)
    })

  rewards
    .command("history")
    .description("the address's reward claims, newest first")
    .argument("<address>", "the staker's address")
    .option("--all", "every claim, not only the newest 20")
    .action(async (address: string, options: unknown, command: Command) => {
      const globals = rt.globals(command)
      const addr = parseOptions(addressSchema, address)
      const { limit } = parseOptions(historySchema, options)
      rt.emit(globals, await rewardsHistory(rt.context(globals), addr, { limit }), renderRewardsHistory)
    })
}
