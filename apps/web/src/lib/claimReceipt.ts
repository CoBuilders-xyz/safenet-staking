import { isAddressEqual, parseEventLogs, type Address, type Log } from "viem"
import { safeTokenEventsAbi } from "@cobuilders/safenet-core"

/**
 * How much SAFE a confirmed claim moved from the MerkleDrop to `account`, read from the
 * SAFE `Transfer` logs in its receipt.
 *
 * The receipt, not the proof: the proof says what the account may claim in total, and the
 * contract pays the difference from what it already paid, which the page read some seconds
 * earlier. The transfer is what actually arrived, so it is what can be restaked.
 *
 * Undefined when the receipt carries no such transfer. That should not happen for a
 * confirmed claim; a caller treats it as "amount unknown", never as zero.
 */
export function claimedAmountFromLogs(
  logs: readonly Log[],
  { token, merkleDrop, account }: { token: Address; merkleDrop: Address; account: Address },
): bigint | undefined {
  const transfers = parseEventLogs({
    abi: safeTokenEventsAbi,
    eventName: "Transfer",
    logs: logs as Log[],
    strict: true,
  }).filter(
    (log) =>
      isAddressEqual(log.address, token) &&
      isAddressEqual(log.args.from, merkleDrop) &&
      isAddressEqual(log.args.to, account),
  )
  if (transfers.length === 0) return undefined
  return transfers.reduce((sum, log) => sum + log.args.value, 0n)
}
