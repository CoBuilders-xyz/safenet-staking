/**
 * The short text that goes with each structured result: the headline figures in one or two
 * sentences. The structured content carries everything, with every figure's source.
 */
import { formatUnits } from "viem"
import type {
  NetworkStatus, NetworkWithdrawals, RewardsCheck, RewardsHistory, StakerWithdrawals, ValidatorDetail, ValidatorList,
  WriteResultBase,
} from "@cobuilders/safenet-cli/lib"

/** An 18-decimal amount in SAFE, exact. */
export const safe = (wei: bigint): string => `${formatUnits(wei, 18)} SAFE`

/**
 * What to do about a refused log scan. The library says what failed; how to set an archive
 * endpoint is the server's business, as it is the CLI's.
 */
export const ARCHIVE_ADVICE =
  "RPC providers differ in log range, rate and retention limits; use an endpoint that serves the required logs; set SAFENET_MCP_RPC_URL or MAINNET_RPC_URL"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function statusSummary(s: NetworkStatus): string {
  return `Safenet at Ethereum Mainnet block ${s.block}: ${safe(s.totalStaked.value)} staked, ` +
    `${plural(s.activeValidators.value, "active validator")}, ${safe(s.pendingWithdrawals.value)} in pending withdrawals. ` +
    `The Merkle root on chain ${s.merkleRoot.match ? "matches" : "differs from"} the one in SEF's latest.json.`
}

export function validatorListSummary(l: ValidatorList): string {
  return `${plural(l.validators.length, "validator")}, ${l.filter === "all" ? "all" : "active only"}, sorted by ${l.sort}, ` +
    `at Ethereum Mainnet block ${l.block}. Participation covers ${l.window.days} days.`
}

export function validatorSummary(d: ValidatorDetail): string {
  const v = d.validator
  const delegators = d.delegators.value
    ? `${d.delegators.value.current} current delegators, ${d.delegators.value.ever} ever`
    : `delegators unavailable: ${d.delegators.unavailableBecause ?? "no reason given"}; ${ARCHIVE_ADVICE}`
  return `Validator ${v.label ?? v.address} at block ${d.block}: ${safe(v.stake)} staked, ` +
    `active ${v.active === null ? "not listed" : v.active ? "yes" : "no"}, registered ${v.registered ? "yes" : "no"}, ${delegators}.`
}

export function withdrawalsSummary(w: NetworkWithdrawals | StakerWithdrawals): string {
  if (w.scope === "address") {
    return `${plural(w.withdrawals.value.length, "pending withdrawal")} for ${w.address}, ${safe(w.total)} in total, at block ${w.block}.`
  }
  return `${plural(w.count.value, "pending withdrawal")} on the network, ${safe(w.total.value)} in total, at block ${w.block}.` +
    (w.logsMatchChain ? "" : " The withdrawal logs do not sum to the total on chain, so the count may be wrong.")
}

export function rewardsCheckSummary(r: RewardsCheck): string {
  if (!r.earned) return `${r.address} never earned rewards: SEF published no proof for it. Claimed on chain: ${safe(r.claimed.value)}.`
  return `${r.address} at block ${r.block}: earned ${safe(r.cumulative.value ?? 0n)}, claimed ${safe(r.claimed.value)}, ` +
    `claimable ${safe(r.claimable.value ?? 0n)}; can claim: ${r.canClaim.value ? "yes" : "no"}` +
    (r.root?.status === "stale proof" ? "; the proof is stale, its root is not the root on chain." : ".")
}

export function rewardsHistorySummary(h: RewardsHistory): string {
  return `${plural(h.count, "reward claim")} by ${h.address}, ${safe(h.totalClaimed)} in total` +
    `${h.limited ? `, the newest ${h.claims.length} shown` : ""}, at block ${h.block}.` +
    (h.sumMatchesChain ? "" : " The claims do not sum to cumulativeClaimed on chain.") +
    (h.periods
      ? ` ${plural(h.periods.periods.length, "distribution period")} from the subgraph at block ${h.periods.subgraph.block}; ` +
        (h.periods.allMatch
          ? "each matches cumulativeClaimed on chain at its last block."
          : "at least one differs from cumulativeClaimed on chain at its last block.") +
        " Claim attribution uses approximate block windows; all update-block claims enter the new window, including earlier claims."
      : ` No periods: ${h.periodsReason ?? "the subgraph gave none"}.`)
}

/** The transactions of one run of a write, sent or simulated. */
export function writeSummary(r: WriteResultBase): string {
  const names = r.steps.map((s) => `${s.contract}.${s.function.split("(")[0]}`).join(", ")
  if (r.dryRun) {
    return `Dry run from ${r.from} at block ${r.block}: ${plural(r.steps.length, "transaction")} would be sent` +
      `${names ? ` (${names})` : ""}; nothing was signed or sent.`
  }
  const hashes = r.steps.map((s) => s.transaction?.hash).filter(Boolean).join(", ")
  return `Sent ${plural(r.steps.length, "transaction")} from ${r.from}${names ? ` (${names})` : ""}` +
    `${hashes ? `: ${hashes}` : ""}.`
}
