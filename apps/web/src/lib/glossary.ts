import { i18n, currentLanguage } from "@/i18n"
import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { formatDuration } from "./format"

/**
 * What each term means, shown where the term appears (`Term`). Each definition restates SEF's
 * staking documentation, read on 2026-10-27: the Staking overview, Lock-up and withdrawals,
 * Rewards, and Risks pages under Safenet Aegis. No figure is written here: the threshold comes
 * from core, and the unstaking period from the staking contract when the caller has read it.
 */
export type GlossaryTerm =
  | "safenet"
  | "staking"
  | "validator"
  | "commission"
  | "unstakingPeriod"
  | "rewards"
  | "slashing"

const THRESHOLD = `${REWARD_PARTICIPATION_THRESHOLD * 100}%`

/** The unstaking period in words, or a phrase that names it when it has not been read yet. */
export function unstakingPeriodText(seconds: bigint | number | undefined): string {
  if (seconds === undefined) return i18n.t("onboarding.theUnstakingPeriod", "the unstaking period")
  if (seconds <= 0) return i18n.t("onboarding.noTime", "no time")
  return formatDuration(Number(seconds), currentLanguage())
}

export function definition(term: GlossaryTerm, unstakingPeriod?: bigint | number): string {
  switch (term) {
    case "safenet":
      return i18n.t("onboarding.safenetIsADecentralisedTransactionsecurityNetworkForSafeAccounts", "Safenet is a decentralised transaction-security network for Safe accounts. Independent Sentinels check transactions, and Validators attest the results. SAFE staked with the Validators backs the network.")
    case "staking":
      return i18n.t("onboarding.stakingOrDelegatingPutsYourSAFEInTheStaking", "Staking, or delegating, puts your SAFE in the staking contract behind a validator you choose. The SAFE stays yours and earns a share of the rewards for that validator's participation. You run nothing, and you do not control the validator.")
    case "validator":
      return i18n.t("onboarding.validatorDefinition", "A validator runs Safenet infrastructure and attests results. Your rewards follow its participation: below {{threshold}} in a reward period, it and its delegators earn nothing for that period.", { threshold: THRESHOLD })
    case "commission":
      return i18n.t("onboarding.theShareOfTheRewardsOnDelegatedSAFEThat", "The share of the rewards on delegated SAFE that the validator keeps. Delegators share the rest. A validator below its self-stake requirement keeps none, and its delegators receive it all.")
    case "unstakingPeriod":
      return i18n.t("onboarding.unstakingDefinition", "After you undelegate, your SAFE waits in the staking contract for {{period}}. Meanwhile it earns no rewards and cannot be moved. Then Claim, on the Withdrawals page, sends it to your wallet. Withdrawals are paid oldest first.", { period: unstakingPeriodText(unstakingPeriod) })
    case "rewards":
      return i18n.t("onboarding.rewardsArePaidForEachRewardPeriodThroughSEFs", "Rewards are paid for each reward period through SEF's distribution contract. They are not added to your stake: you claim them. A claim collects everything not yet claimed. Rewards are not guaranteed.")
    case "slashing":
      return i18n.t("onboarding.slashingTakesPartOfAStakeAsAPenalty", "Slashing takes part of a stake as a penalty. SAFE staked or delegated is not currently subject to slashing: a validator that performs badly costs rewards, not the SAFE itself.")
  }
}
