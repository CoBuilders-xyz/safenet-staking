import type { Command } from "commander"
import { getStatus, type DerivedFigure, type NetworkStatus } from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { describeRewardsSource, formatCount, formatSafe, formatTime, renderTable } from "./format.js"

const derived = (f: DerivedFigure) =>
  f.value === null ? `not derivable: ${f.reason ?? "no value"}` : formatSafe(f.value)

export function renderStatus(s: NetworkStatus): string {
  const epoch = s.rewardsEpoch.value
  const rows: [string, string, string][] = [
    ["SAFE staked", formatSafe(s.totalStaked.value), s.totalStaked.source],
    ["SAFE staked, SEF snapshot", formatSafe(s.totalStakedPublished.value), s.totalStakedPublished.source],
    ["Active validators", formatCount(s.activeValidators.value), s.activeValidators.source],
    [
      "Registered validators",
      `${s.registeredValidators.value.registered} of ${s.registeredValidators.value.listed} listed`,
      s.registeredValidators.source,
    ],
    ["Pending withdrawals", formatSafe(s.pendingWithdrawals.value), s.pendingWithdrawals.source],
    ["Rewards allocated", derived(s.rewardsAllocated), s.rewardsAllocated.source],
    [
      "Rewards period",
      `epoch ${epoch.epoch}, rewards until ${formatTime(new Date(epoch.rewardsUntil))}`,
      s.rewardsEpoch.source,
    ],
    ["Rewards unclaimed", derived(s.rewardsUnclaimed), s.rewardsUnclaimed.source],
    ["SAFE held by MerkleDrop", formatSafe(s.merkleDropBalance.value), s.merkleDropBalance.source],
    ["Merkle root, chain", s.merkleRoot.onChain.value, s.merkleRoot.onChain.source],
    ["Merkle root, published", s.merkleRoot.published.value, s.merkleRoot.published.source],
    ["Rewards data", describeRewardsSource(s.rewardsSource), s.rewardsSource.url],
  ]
  const root = s.merkleRoot.match
    ? "Merkle root: match. The root on chain is the root in SEF's latest.json."
    : "Merkle root: differs. The root on chain is not the root in SEF's latest.json."
  return [
    `Safenet on Ethereum Mainnet, block ${formatCount(s.block)}`,
    "",
    renderTable([{ header: "FIGURE" }, { header: "VALUE" }, { header: "SOURCE" }], rows),
    "",
    root,
  ].join("\n")
}

export function registerStatus(program: Command, rt: CommandRuntime): void {
  program
    .command("status")
    .description("network totals: stake, validators, withdrawals, rewards and the Merkle root")
    .action(async (_options: unknown, command: Command) => {
      const globals = rt.globals(command)
      rt.emit(globals, await getStatus(rt.context(globals)), renderStatus)
    })
}
