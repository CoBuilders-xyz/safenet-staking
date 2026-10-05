/**
 * Event scans in bounded block ranges.
 *
 * Providers cap the range and the size of one eth_getLogs response, and word the error
 * differently. So the scan does not parse the error: it shrinks the range and retries the SAME
 * blocks, and throws once the smallest range still fails. A range is never skipped, because a
 * skipped range would print a plausible total that is too low. Same method as
 * packages/core/scripts/metrics-poc.ts.
 */
import type { AbiEvent, Address, GetLogsParameters, GetLogsReturnType } from "viem"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"

export const MIN_CHUNK = 1_000n
const ATTEMPTS_AT_MIN = 3

export interface ScanRequest<E extends AbiEvent> {
  readonly address: Address
  readonly event: E
  readonly args?: GetLogsParameters<E>["args"]
  readonly fromBlock: bigint
  readonly toBlock: bigint
  /** The first range tried. It doubles back up after a shrink. */
  readonly startChunk?: bigint
}

/** A log scan that could not complete. Every range is read or the whole scan fails. */
export class ScanError extends SafenetError {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function scanLogs<E extends AbiEvent>(
  ctx: Pick<Context, "client" | "retryDelayMs">,
  request: ScanRequest<E>,
): Promise<GetLogsReturnType<E>> {
  const { client } = ctx
  const startChunk = request.startChunk ?? 50_000n
  const out: GetLogsReturnType<E> = []
  let from = request.fromBlock
  let chunk = startChunk
  let attemptsAtMin = 0

  while (from <= request.toBlock) {
    const to = from + chunk - 1n > request.toBlock ? request.toBlock : from + chunk - 1n
    try {
      const logs = (await client.getLogs({
        address: request.address,
        event: request.event,
        args: request.args,
        fromBlock: from,
        toBlock: to,
      } as GetLogsParameters<E>)) as GetLogsReturnType<E>
      out.push(...logs)
      from = to + 1n
      attemptsAtMin = 0
      if (chunk < startChunk) chunk *= 2n
    } catch {
      if (chunk > MIN_CHUNK) {
        chunk = chunk / 4n > MIN_CHUNK ? chunk / 4n : MIN_CHUNK
        continue
      }
      attemptsAtMin++
      if (attemptsAtMin >= ATTEMPTS_AT_MIN) {
        throw new ScanError(
          `The RPC endpoint refused ${request.event.name} logs for blocks ${from} to ${to}, so the ` +
            `scan stopped rather than skip them; the public endpoints refuse historical log scans, ` +
            `so set MAINNET_RPC_URL or pass --rpc-url with an archive endpoint`,
        )
      }
      await sleep((ctx.retryDelayMs ?? 1_000) * attemptsAtMin)
    }
  }
  return out
}
