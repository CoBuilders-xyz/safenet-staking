import { i18n, currentLanguage } from "@/i18n"
/**
 * Which gate closed the interface, and why.
 *
 * Every gate fails closed. "unavailable" means the gate could not reach an answer, not that the
 * visitor was refused, and the screen says so, because the remedy differs: a retry can open an
 * unavailable gate, and nothing in this interface opens a refusal.
 */
export type Restriction =
  | { gate: "sanctionsApi"; reason: "refused" | "unavailable" }
  | { gate: "geoblock"; reason: "region"; country: string }
  | { gate: "geoblock"; reason: "unavailable" }
  | { gate: "walletSanctions"; reason: "flagged" | "unavailable" }

/** What one gate reported. A closed gate without a reason is still closed. */
export interface GateResult {
  allowed: boolean
  restriction?: Restriction
}

/**
 * The restriction to show when gates are closed, given in the order they are checked; undefined
 * when every gate is open. A refusal is named before a check that could not answer, because a
 * retry cannot lift a refusal and the screen must not offer one as the way in. Among refusals,
 * and among failed checks, the first gate wins. A closed gate with no reason is a failed check
 * of that gate.
 */
export function chooseRestriction(
  gates: readonly (GateResult & { gate: Restriction["gate"] })[],
): Restriction | undefined {
  const closed = gates
    .filter((g) => !g.allowed)
    .map((g): Restriction => g.restriction ?? ({ gate: g.gate, reason: "unavailable" } as Restriction))
  return closed.find((r) => r.reason !== "unavailable") ?? closed[0]
}

export interface RestrictionCopy {
  title: string
  /** The gate, as the visitor sees it named. */
  gate: string
  /** What refused, and why. */
  description: string
  /** What the visitor can do. */
  remedy: string
}

/** The localized name of an ISO 3166-1 alpha-2 code, or the code when the browser has none. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([currentLanguage()], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

export function restrictionCopy(restriction: Restriction): RestrictionCopy {
const RETRY =
  i18n.t("onboarding.thisIsOftenANetworkProblemOrABrowser", "This is often a network problem, or a browser extension that blocks the request. Try again once it is resolved.")
const FINAL = i18n.t("onboarding.thisInterfaceCannotLiftTheRestriction", "This interface cannot lift the restriction.")


  switch (restriction.gate) {
    case "sanctionsApi":
      return restriction.reason === "refused"
        ? {
            title: i18n.t("shell.accessRestricted.title", "Access Restricted"),
            gate: i18n.t("onboarding.sanctionsScreening", "Sanctions screening"),
            description: i18n.t("onboarding.theSanctionsScreeningServiceRefusedThisConnectionSoSAFE", "The sanctions screening service refused this connection, so SAFE Staking and Rewards are closed to it."),
            remedy: FINAL,
          }
        : {
            title: i18n.t("onboarding.accessCheckFailed", "Access Check Failed"),
            gate: i18n.t("onboarding.sanctionsScreening", "Sanctions screening"),
            description: i18n.t("onboarding.theSanctionsScreeningServiceDidNotAnswerSoThe", "The sanctions screening service did not answer, so the interface stays closed until it does."),
            remedy: RETRY,
          }
    case "geoblock":
      return restriction.reason === "region"
        ? {
            title: i18n.t("shell.accessRestricted.title", "Access Restricted"),
            gate: i18n.t("onboarding.locationCheck", "Location check"),
            description: i18n.t("onboarding.regionRestricted", "SAFE Staking and Rewards are unavailable in {{country}}, where your connection appears to be. The location comes from your IP address.", { country: countryName(restriction.country) }),
            remedy: FINAL,
          }
        : {
            title: i18n.t("onboarding.accessCheckFailed", "Access Check Failed"),
            gate: i18n.t("onboarding.locationCheck", "Location check"),
            description: i18n.t("onboarding.neitherLocationServiceAnsweredSoTheInterfaceStaysClosed", "Neither location service answered, so the interface stays closed until one does."),
            remedy: RETRY,
          }
    case "walletSanctions":
      return restriction.reason === "flagged"
        ? {
            title: i18n.t("shell.walletRestricted.title", "Wallet Restricted"),
            gate: i18n.t("onboarding.walletScreening", "Wallet screening"),
            description: i18n.t("onboarding.theSanctionsOracleOnEthereumListsThisWalletAddress", "The sanctions oracle on Ethereum lists this wallet address, so it cannot use SAFE Staking."),
            remedy: i18n.t("onboarding.walletRefusedRemedy", "{{reason}} Disconnect the wallet to keep reading the public figures.", { reason: FINAL }),
          }
        : {
            title: i18n.t("onboarding.walletCheckFailed", "Wallet Check Failed"),
            gate: i18n.t("onboarding.walletScreening", "Wallet screening"),
            description: i18n.t("onboarding.theSanctionsOracleOnEthereumCouldNotBeRead", "The sanctions oracle on Ethereum could not be read for this wallet, so the interface stays closed until it can."),
            remedy: i18n.t("onboarding.walletRetryRemedy", "{{reason}} Or disconnect the wallet to keep reading the public figures.", { reason: RETRY }),
          }
  }
}
