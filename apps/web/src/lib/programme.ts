import { AEGIS_START_DAY, BETA_END_DAY, REWARD_PARTICIPATION_THRESHOLD, utcDayMs } from "@cobuilders/safenet-core"
import { formatUtcDayLong } from "./format"

/** SEF's reward rule, shown beside every participation rate. */
export const PARTICIPATION_RULE = `If a validator's participation is below ${REWARD_PARTICIPATION_THRESHOLD * 100}% in a reward period, both the validator and its delegators earn no rewards for that period.`

/** The short form of the threshold, for a marker beside a rate. */
export const THRESHOLD_LABEL = `${REWARD_PARTICIPATION_THRESHOLD * 100}%`

/** Shown where SEF's file lists a validator with a null rate, in place of a percentage. */
export const RATE_NOT_PUBLISHED = "Not published"

/** True when a participation rate, as a fraction, is below the reward threshold. */
export function belowThreshold(rate: number): boolean {
  return rate < REWARD_PARTICIPATION_THRESHOLD
}

/** Shown above Gnosis figures that all describe Beta, which stopped attesting when it ended. */
export const BETA_ENDED_NOTICE = `Beta ended on ${formatUtcDayLong(utcDayMs(BETA_END_DAY))}. Aegis data starts on ${formatUtcDayLong(utcDayMs(AEGIS_START_DAY))}.`

/**
 * The status of a validator SEF's list marks `is_active: false`. Its stake and its past
 * participation stay on screen; whether it takes part in Aegis is not confirmed.
 */
export const WITHDRAWN = "Withdrawn"
export const AEGIS_UNCONFIRMED = "Aegis participation unconfirmed"
export const WITHDRAWN_STATUS = `${WITHDRAWN}, ${AEGIS_UNCONFIRMED}`
