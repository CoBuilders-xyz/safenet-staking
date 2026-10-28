import { i18n } from "@/i18n"
/** Sentences more than one Rewards section shows. Kept here so each is written once. */
export const MESSAGES = {
  get noMerkleDrop() { return i18n.t("rewards.noMerkleDrop", "No rewards contract is configured for this network.") },
  get latestFileFailed() { return i18n.t("rewards.latestFileFailed", "SEF's published rewards file could not be loaded.") },
  get contractReadFailed() { return i18n.t("rewards.contractReadFailed", "The MerkleDrop contract could not be read from Ethereum.") },
} as const
