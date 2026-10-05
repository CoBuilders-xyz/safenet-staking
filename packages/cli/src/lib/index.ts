/**
 * The safenet library: one function per operation, each returning typed data.
 *
 * The CLI formats what these return, and the MCP server will call them directly. Nothing here
 * prints, reads argv, or exits.
 */
export { createContext, rpcEndpoints, rpcHosts, type Context, type ContextOptions } from "./context.js"
export { SafenetError } from "./errors.js"
export { figure, type Figure } from "./figure.js"
export { ScanError, scanLogs, type ScanRequest } from "./scan.js"
export { fetchValidatorsWithWindow, type ParticipationWindow } from "./sef.js"
export { getStatus, type NetworkStatus } from "./status.js"
export {
  listValidators, showValidator, sortValidators, VALIDATOR_SOURCES,
  type Validator, type ValidatorDetail, type ValidatorFilter, type ValidatorList, type ValidatorSort,
} from "./validators.js"
export {
  networkWithdrawals, stakerWithdrawals,
  type NetworkWithdrawals, type PendingWithdrawal, type StakerWithdrawals,
} from "./withdrawals.js"
export {
  checkRewards, rewardsHistory, DEFAULT_HISTORY_LIMIT,
  type Claim, type RewardsCheck, type RewardsHistory,
} from "./rewards.js"
