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
export { getStatus, ROOT_DIFFERS, type DerivedFigure, type NetworkStatus } from "./status.js"
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

// Writes. Each takes a WriteMode: a signer to send with, or an address to simulate from.
export { localSigner, type Signer, type TransactionToSend } from "./signer.js"
export { decryptKeystore } from "./keystore.js"
export {
  amount, createRunner, revertError, WriteError,
  type Amount, type Progress, type SentTransaction, type Step, type WriteMode, type WriteOptions, type WriteResultBase,
} from "./transactions.js"
export {
  stake, unstake, type Approval, type ApprovalKind, type StakeResult, type UnstakeResult,
} from "./stake.js"
export {
  claimWithdrawals, readQueue, type ClaimedWithdrawal, type ClaimWithdrawalsResult, type QueuedWithdrawal,
} from "./claim-withdrawals.js"
export {
  claimAndStake, claimRewards, receivedFromLogs,
  type ClaimAndStakeResult, type RewardsClaim, type RewardsClaimResult,
} from "./claim-rewards.js"
