/**
 * The part of `@cobuilders/safenet-cli/lib` the server calls. The server takes it as an argument,
 * so the tests can hand it a fake and check every call.
 */
import * as lib from "@cobuilders/safenet-cli/lib"

export type Library = Pick<
  typeof lib,
  | "createContext"
  | "getStatus" | "listValidators" | "showValidator" | "networkWithdrawals" | "stakerWithdrawals"
  | "checkRewards" | "rewardsHistory"
  | "stake" | "unstake" | "claimWithdrawals" | "claimRewards" | "claimAndStake"
>

export const library: Library = lib
