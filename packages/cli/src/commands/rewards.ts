import type { Command } from "commander"
import {
  checkRewards, claimAndStake, claimRewards, rewardsHistory,
  type ClaimAndStakeResult, type RewardsCheck, type RewardsClaim, type RewardsClaimResult, type RewardsHistory,
} from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { describeRewardsSource, formatCount, formatSafe, formatTime, renderTable } from "./format.js"
import { addressSchema, claimAndStakeSchema, historySchema, parseOptions, writeSchema } from "./options.js"
import {
  addWriteOptions, approvalText, figureRow, renderFigures, renderProgress, renderSteps, writeHead, type FigureRow,
} from "./write.js"

const safe = (a: { wei: bigint }) => formatSafe(a.wei)

function claimRows(c: RewardsClaim): FigureRow[] {
  const rows: FigureRow[] = [
    figureRow("Earned to date", c.cumulative, safe),
    figureRow("Claimed before", c.claimedBefore, safe),
    figureRow("Claimable", c.claimable, safe),
    figureRow("Merkle root", c.merkleRoot, String),
    figureRow("Received", c.received, (a) => (a ? safe(a) : "unknown: no such transfer")),
  ]
  if (c.claimedAfter) rows.push(figureRow("Claimed after", c.claimedAfter, safe))
  return rows
}

export function renderRewardsClaim(r: RewardsClaimResult): string {
  return [
    ...writeHead(r, "Claim rewards"),
    "",
    renderFigures(claimRows(r.claim)),
    "",
    `Proof: ${r.claim.proofUrl}, from ${describeRewardsSource(r.claim.proofSource)}`,
    "",
    renderSteps(r.steps),
  ].join("\n")
}

export function renderClaimAndStake(r: ClaimAndStakeResult): string {
  const rows: FigureRow[] = [...claimRows(r.claim)]
  if (r.requested) rows.push(["Requested", safe(r.requested), "--amount"])
  rows.push(
    ["Staked", safe(r.staked), r.cappedToReceived
      ? "what arrived, which is less than --amount"
      : r.requested ? "--amount" : "what arrived"],
    figureRow("Allowance", r.allowance, safe),
    ["Approval", approvalText(r.approval), "sent only when the allowance is below the amount"],
    figureRow("Stake before", r.stakeBefore, safe),
  )
  if (r.stakeAfter) rows.push(figureRow("Stake after", r.stakeAfter, safe))
  return [
    ...writeHead(r, `Claim rewards and stake them on validator ${r.validator}`),
    "",
    renderFigures(rows),
    "",
    `Proof: ${r.claim.proofUrl}, from ${describeRewardsSource(r.claim.proofSource)}`,
    "",
    renderSteps(r.steps),
  ].join("\n")
}

export function renderRewardsCheck(r: RewardsCheck): string {
  const head = `Rewards for ${r.address}, Ethereum Mainnet block ${formatCount(r.block)}`
  if (!r.earned) {
    const lines = [
      head,
      "",
      "Never earned: SEF published no reward proof for this address (the file is a 404).",
      `Claimed on chain: ${formatSafe(r.claimed.value)} (${r.claimed.source}).`,
      `No proof at ${r.proofUrl}; settled by ${describeRewardsSource(r.proofSource)}.`,
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
  rows.push(["Proof read from", describeRewardsSource(r.proofSource), r.proofUrl])
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

/** The periods section: one row per distribution, newest first, each checked at its last block. */
export function renderPeriods(h: RewardsHistory): string {
  if (!h.periods) return `Periods: not shown, because ${h.periodsReason ?? "the subgraph gave none"}.`
  const p = h.periods
  const head = `Periods, from the subgraph at block ${formatCount(p.subgraph.block)} (${formatTime(p.subgraph.time)})` +
    `${p.subgraph.stale ? ", which trails the chain by more than its staleness limit" : ""}:`
  const table = renderTable(
    [
      { header: "PERIOD", align: "right" }, { header: "ROOT SET" }, { header: "LAST BLOCK", align: "right" },
      { header: "CLAIMS", align: "right" }, { header: "CLAIMED", align: "right" },
      { header: "CUMULATIVE, SUBGRAPH", align: "right" }, { header: "CUMULATIVE, CHAIN", align: "right" }, { header: "CHECK" },
    ],
    [...p.periods].reverse().map((r) => [
      String(r.period),
      formatTime(r.setAt.time),
      `${formatCount(r.endBlock)}${r.current ? " (current)" : ""}`,
      String(r.claims),
      formatSafe(r.claimed),
      formatSafe(r.cumulativeAtEnd.subgraph),
      formatSafe(r.cumulativeAtEnd.chain),
      r.cumulativeAtEnd.match ? "match" : "DIFFERS",
    ]),
  )
  const verdict = p.allMatch
    ? `Every period: the subgraph's cumulative claimed equals MerkleDrop.cumulativeClaimed(address) on chain at the period's last block.`
    : `Check failed for period ${p.periods.filter((r) => !r.cumulativeAtEnd.match).map((r) => r.period).join(", ")}: ` +
      "the subgraph and the chain differ at the same block."
  return [
    head, "", table, "", verdict,
    "A period's CLAIMED is what this address claimed while that root was current. What a period paid out is in SEF's files, not on chain.",
    `Source: ${p.subgraph.source}.`,
  ].join("\n")
}

export function renderRewardsHistory(h: RewardsHistory): string {
  const head = `Reward claims by ${h.address}, Ethereum Mainnet block ${formatCount(h.block)}`
  const source = `Source: ${h.source}.`
  if (h.count === 0) return [head, "", "None.", source, "", renderPeriods(h)].join("\n")
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
  return [head, "", table, "", shown, check, source, "", renderPeriods(h)].join("\n")
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

  addWriteOptions(
    rewards
      .command("claim")
      .description("claim the signer's rewards with SEF's published proof, while its root is the root on chain"),
  ).action(async (options: unknown, command: Command) => {
    const globals = rt.globals(command)
    const request = parseOptions(writeSchema, options)
    const ctx = rt.context(globals)
    const mode = await rt.writeMode(request, ctx)
    rt.emit(globals, await claimRewards(ctx, mode, { onProgress: rt.progress(renderProgress) }), renderRewardsClaim)
  })

  addWriteOptions(
    rewards
      .command("claim-and-stake")
      .description("claim the signer's rewards, then approve and stake what arrived on a validator, one transaction after another")
      .argument("<validator>", "the validator's address")
      .option(
        "--amount <amount>",
        "stake this much SAFE and leave the rest in the wallet; more than the claimable amount is refused before anything is sent",
      )
      .option("--approve <kind>", "when an approval is needed: exact (the amount) or unlimited", "exact"),
  ).action(async (validator: string, options: unknown, command: Command) => {
    const globals = rt.globals(command)
    const request = parseOptions(writeSchema, options)
    const { approve, amount } = parseOptions(claimAndStakeSchema, options)
    const input = { validator: parseOptions(addressSchema, validator), amount, approve }
    const ctx = rt.context(globals)
    const mode = await rt.writeMode(request, ctx)
    rt.emit(
      globals,
      await claimAndStake(ctx, mode, input, { onProgress: rt.progress(renderProgress) }),
      renderClaimAndStake,
    )
  })
}
