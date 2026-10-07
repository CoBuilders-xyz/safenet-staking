import { SEF_REWARDS_ENS_NAME, type RewardsDataBase, type RewardsEnsState } from "@cobuilders/safenet-core"

/** Which source a reward file came from, as the verifiability panel names it. */
export function rewardsSourceLabel(base: RewardsDataBase): string {
  switch (base.kind) {
    case "ens": return "SEF's IPFS dataset (ENS)"
    case "repository": return "SEF's repository"
    case "override": return "A configured URL"
  }
}

/** The gateway's host for the IPFS dataset; the server's host for the other sources. */
export function rewardsSourceHost(base: RewardsDataBase): string {
  return new URL(base.gateway ?? base.url).host
}

/** Why the repository mirror was read rather than the canonical dataset. */
export function repositoryReason(ens: RewardsEnsState | null): string | undefined {
  switch (ens?.status) {
    case "empty": return `${SEF_REWARDS_ENS_NAME} points at no dataset yet.`
    case "unsupported": return `${SEF_REWARDS_ENS_NAME} holds a contenthash this page cannot read.`
    case "unreadable": return `${SEF_REWARDS_ENS_NAME} could not be read.`
    case "set": return "SEF's IPFS dataset did not answer through any gateway."
    default: return undefined
  }
}
