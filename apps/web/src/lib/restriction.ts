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

/** The English name of an ISO 3166-1 alpha-2 code, or the code when the browser has none. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

const RETRY =
  "This is often a network problem, or a browser extension that blocks the request. Try again once it is resolved."
const FINAL = "This interface cannot lift the restriction."

export function restrictionCopy(restriction: Restriction): RestrictionCopy {
  switch (restriction.gate) {
    case "sanctionsApi":
      return restriction.reason === "refused"
        ? {
            title: "Access Restricted",
            gate: "Sanctions screening",
            description: "The sanctions screening service refused this connection, so SAFE Staking and Rewards are closed to it.",
            remedy: FINAL,
          }
        : {
            title: "Access Check Failed",
            gate: "Sanctions screening",
            description: "The sanctions screening service did not answer, so the interface stays closed until it does.",
            remedy: RETRY,
          }
    case "geoblock":
      return restriction.reason === "region"
        ? {
            title: "Access Restricted",
            gate: "Location check",
            description: `SAFE Staking and Rewards are unavailable in ${countryName(restriction.country)}, where your connection appears to be. The location comes from your IP address.`,
            remedy: FINAL,
          }
        : {
            title: "Access Check Failed",
            gate: "Location check",
            description: "Neither location service answered, so the interface stays closed until one does.",
            remedy: RETRY,
          }
    case "walletSanctions":
      return restriction.reason === "flagged"
        ? {
            title: "Wallet Restricted",
            gate: "Wallet screening",
            description: "The sanctions oracle on Ethereum lists this wallet address, so it cannot use SAFE Staking.",
            remedy: `${FINAL} Disconnect the wallet to keep reading the public figures.`,
          }
        : {
            title: "Wallet Check Failed",
            gate: "Wallet screening",
            description: "The sanctions oracle on Ethereum could not be read for this wallet, so the interface stays closed until it can.",
            remedy: `${RETRY} Or disconnect the wallet to keep reading the public figures.`,
          }
  }
}
