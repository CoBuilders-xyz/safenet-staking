import { i18n } from "@/i18n"
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi } from "viem"

const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  get InvalidAmount() { return i18n.t("errors.InvalidAmount", "Amount must be greater than zero") },
  get NotValidator() { return i18n.t("errors.NotValidator", "This validator is not registered") },
  get InsufficientStake() { return i18n.t("errors.InsufficientStake", "Insufficient delegation balance") },
  get WithdrawalQueueEmpty() { return i18n.t("errors.WithdrawalQueueEmpty", "No pending withdrawals to claim") },
  get NoClaimableWithdrawal() { return i18n.t("errors.NoClaimableWithdrawal", "No withdrawal is ready to claim yet") },
  get InvalidAddress() { return i18n.t("errors.InvalidAddress", "Invalid address provided") },
  get InvalidProof() { return i18n.t("errors.InvalidProof", "Invalid merkle proof — rewards data may be outdated") },
  get NothingToClaim() { return i18n.t("errors.NothingToClaim", "No rewards available to claim") },
  get MerkleRootWasUpdated() { return i18n.t("errors.MerkleRootWasUpdated", "Rewards data was updated — please try again") },
}

export function formatContractError(error: Error): string {
  const msg = error.message || ""

  // 1. User rejected
  if (msg.includes("User rejected") || msg.includes("user rejected")) {
    return i18n.t("errors.Transactionrejected", "Transaction rejected")
  }

  // 2. Known custom error name (viem decoded)
  const customMatch = msg.match(/reverted with custom error '(\w+)\(/i)
  if (customMatch) {
    const name = customMatch[1]
    if (CUSTOM_ERROR_MESSAGES[name]) return CUSTOM_ERROR_MESSAGES[name]
    return name
  }

  // 2b. Signature-based custom error with name in message
  const nameMatch = msg.match(/error (\w+)\(\)/i)
  if (nameMatch) {
    const name = nameMatch[1]
    if (CUSTOM_ERROR_MESSAGES[name]) return CUSTOM_ERROR_MESSAGES[name]
    return name
  }

  // 3. Solidity revert reason string
  const reasonMatch = msg.match(/reverted with the following reason:\s*\n?\s*(.+)/i)
  if (reasonMatch) return reasonMatch[1].trim()

  // 4. Insufficient funds for gas
  if (
    msg.includes("insufficient funds") ||
    msg.includes("exceeds the balance") ||
    msg.includes("not enough funds")
  ) {
    return i18n.t("errors.InsufficientETHforgasfees", "Insufficient ETH for gas fees")
  }

  // 5. Network/RPC error
  if (
    msg.includes("network") ||
    msg.includes("disconnected") ||
    msg.includes("timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("could not coalesce")
  ) {
    return i18n.t("errors.Networkerrorpleasetryagain", "Network error — please try again")
  }

  // 6. Fallback — generic message (avoid leaking RPC URLs or internal state)
  return i18n.t("errors.AnunexpectederroroccurredPleasetry", "An unexpected error occurred. Please try again.")
}

/**
 * The custom error a contract reverted with, by name, or undefined when there is none to find.
 *
 * Two routes. viem decodes the revert itself when it simulated or estimated the call with the
 * ABI. A revert that arrives undecoded, such as wagmi replaying a transaction that reverted on
 * chain, still carries the 4-byte selector in its message, so that is matched against `abi`.
 */
export function revertedErrorName(error: unknown, abi: Abi): string | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return reverted.data.errorName
    }
  }

  let text = ""
  for (let e: unknown = error; e instanceof Error; e = e.cause) text += ` ${e.message}`
  for (const [selector] of text.matchAll(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/g)) {
    try {
      return decodeErrorResult({ abi, data: selector as `0x${string}` }).errorName
    } catch {
      // Not one of this ABI's errors. Keep looking.
    }
  }
  return undefined
}
