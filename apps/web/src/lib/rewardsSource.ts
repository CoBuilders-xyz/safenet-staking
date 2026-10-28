import { i18n } from "@/i18n"
import {
  SEF_REWARDS_ENS_NAME, datasetMiss, type RewardsAttempt, type RewardsDataBase, type RewardsEnsState,
} from "@cobuilders/safenet-core"

/** Which source a reward file came from, as the verifiability panel names it. */
export function rewardsSourceLabel(base: RewardsDataBase): string {
  switch (base.kind) {
    case "ens": return i18n.t("rewards.sourceEns", "SEF's IPFS dataset (ENS)")
    case "repository": return i18n.t("rewards.sourceRepository", "SEF's repository")
    case "override": return i18n.t("rewards.sourceOverride", "A configured URL")
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
    case "empty": return i18n.t("rewards.ensEmpty", "{{name}} points at no dataset yet.", { name: SEF_REWARDS_ENS_NAME })
    case "unsupported": return i18n.t("rewards.ensUnsupported", "{{name}} is set in a form this page cannot read.", { name: SEF_REWARDS_ENS_NAME })
    case "unreadable": return i18n.t("rewards.ensUnreadable", "{{name}} could not be read.", { name: SEF_REWARDS_ENS_NAME })
    case "set":
      return datasetMiss(tried) === "not found"
        ? i18n.t("rewards.datasetMissing", "SEF's IPFS dataset has no latest.json at the expected path.")
        : i18n.t("rewards.gatewaysFailed", "SEF's IPFS dataset did not answer through any gateway.")
    default: return undefined
  }
}

/**
 * A caveat for "no proof" when only the repository mirror settled it: SEF's IPFS dataset, the
 * canonical source, was tried and did not answer. Undefined when the dataset was not tried, or
 * answered 404 too.
 */
export function proofAbsenceCaveat(
  source: { base: RewardsDataBase; tried: readonly RewardsAttempt[] } | undefined,
): string | undefined {
  if (source?.base.kind !== "repository" || datasetMiss(source.tried) !== "unanswered") return undefined
  return i18n.t("rewards.mirrorCaveat", "SEF's IPFS dataset, the canonical source, did not answer, so this rests on SEF's repository, a mirror.")
}
