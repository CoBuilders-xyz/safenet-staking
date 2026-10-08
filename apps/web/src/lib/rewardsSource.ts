import {
  SEF_REWARDS_ENS_NAME, datasetMiss, type RewardsAttempt, type RewardsDataBase, type RewardsEnsState,
} from "@cobuilders/safenet-core"

/** Which source a reward file came from, as the verifiability panel names it. */
export function rewardsSourceLabel(base: RewardsDataBase): string {
  switch (base.kind) {
    case "ens": return "SEF's IPFS dataset (ENS)"
    case "repository": return "SEF's repository"
    case "override": return "A configured URL"
  }
}

/**
 * The gateway's host for the IPFS dataset; the server's host for the other sources. A relative
 * VITE_REWARDS_BASE_URL is resolved against the page, so it names the page's own host.
 */
export function rewardsSourceHost(base: RewardsDataBase): string {
  const url = base.gateway ?? base.url
  try {
    return new URL(url, globalThis.location?.href).host
  } catch {
    return url
  }
}

/**
 * Why the repository mirror was read rather than the canonical dataset. A dataset that answered
 * 404 on every gateway is told apart from one that did not answer: the first points at the
 * dataset's layout, the second at the gateways.
 */
export function repositoryReason(ens: RewardsEnsState | null, tried: readonly RewardsAttempt[]): string | undefined {
  switch (ens?.status) {
    case "empty": return `${SEF_REWARDS_ENS_NAME} points at no dataset yet.`
    case "unsupported": return `${SEF_REWARDS_ENS_NAME} is set in a form this page cannot read.`
    case "unreadable": return `${SEF_REWARDS_ENS_NAME} could not be read.`
    case "set":
      return datasetMiss(tried) === "not found"
        ? "SEF's IPFS dataset has no latest.json at the expected path."
        : "SEF's IPFS dataset did not answer through any gateway."
    default: return undefined
  }
}
