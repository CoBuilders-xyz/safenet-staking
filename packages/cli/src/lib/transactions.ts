/**
 * Sending the transactions of one operation, or simulating them without sending.
 *
 * An operation hands its calls to a `Runner` one at a time, in order. Both runners simulate each
 * call with `eth_call` and estimate its gas before anything else, so a revert is decoded into a
 * sentence before any key is used.
 *
 * - The live runner then has the signer send the call, waits for the receipt, and fails on a
 *   revert. Each call is simulated against the chain after the previous one confirmed.
 * - The dry runner has no signer. A call that depends on an earlier one in the same operation,
 *   such as a stake after its approval, cannot be estimated with `eth_estimateGas`, which only
 *   sees mined state. Those calls are simulated with `eth_simulateV1`, after the calls before
 *   them, and their gas is the gas the simulation used.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  encodeFunctionData,
  formatUnits,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hash,
  type Hex,
  type Log,
} from "viem"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { figure, type Figure } from "./figure.js"
import type { Signer } from "./signer.js"

/** A SAFE amount: wei, exact, and the same value in SAFE as a decimal string. */
export interface Amount {
  readonly wei: bigint
  readonly safe: string
}

export const amount = (wei: bigint): Amount => ({ wei, safe: formatUnits(wei, 18) })

/** A contract call an operation wants to send. Build it with `call()`. */
export interface Call {
  /** The contract's name in output: "Staking", "MerkleDrop", "SAFE token". */
  readonly contract: string
  readonly address: Address
  readonly abi: Abi
  readonly functionName: string
  readonly args: readonly unknown[]
}

export function call<const abi extends Abi, name extends ContractFunctionName<abi, "nonpayable">>(
  contract: string,
  address: Address,
  abi: abi,
  functionName: name,
  args: ContractFunctionArgs<abi, "nonpayable", name>,
): Call {
  return { contract, address, abi, functionName, args: args as readonly unknown[] }
}

export interface SentTransaction {
  readonly hash: Hash
  readonly status: "success" | "reverted"
  readonly block: bigint
  readonly gasUsed: bigint
}

/** One transaction of an operation: what it sends, and what happened to it. */
export interface Step {
  readonly contract: string
  readonly to: Address
  /** The function with its parameter types and names, as in the ABI. */
  readonly function: string
  /** The arguments by parameter name. */
  readonly args: Readonly<Record<string, unknown>>
  readonly data: Hex
  readonly gas: Figure<bigint>
  /** Null in a dry run: nothing was sent. */
  readonly transaction: SentTransaction | null
}

/** What a live run reports while it runs, so a caller can show each hash as it lands. */
export type Progress =
  | { readonly type: "sent"; readonly contract: string; readonly functionName: string; readonly hash: Hash }
  | { readonly type: "confirmed"; readonly step: Step }
  | { readonly type: "received"; readonly amount: Amount; readonly source: string }

/** How an operation runs: simulated from an address, or sent by a signer. */
export type WriteMode =
  | { readonly dryRun: true; readonly from: Address }
  | { readonly dryRun: false; readonly signer: Signer }

export interface WriteOptions {
  readonly onProgress?: (event: Progress) => void
}

/** What every write operation returns, around its own figures. */
export interface WriteResultBase {
  readonly dryRun: boolean
  readonly from: Address
  /** The block the reads before the first transaction were made at. */
  readonly block: bigint
  readonly steps: readonly Step[]
}

/** A write that failed. `steps` holds the transactions already confirmed, which stay on chain. */
export class WriteError extends SafenetError {
  constructor(message: string, readonly steps: readonly Step[]) {
    super(message)
  }
}

/** What the contract means by each custom error in core's ABIs, as the end of a sentence. */
const REVERT_REASONS: Readonly<Record<string, string>> = {
  InvalidAmount: "the amount must be more than zero",
  NotValidator: "the address is not a registered validator",
  InvalidAddress: "the contract refuses the address as invalid",
  InsufficientStake: "the stake on that validator is less than the amount",
  WithdrawalQueueEmpty: "there is no pending withdrawal to claim",
  NoClaimableWithdrawal: "the oldest pending withdrawal is still in its delay",
  InvalidProof: "the MerkleDrop refuses the proof",
  NothingToClaim: "everything in the proof was already claimed",
  MerkleRootWasUpdated: "the Merkle root on chain changed after the proof was read, so the proof is stale",
}

function signatureText(c: Call): string {
  const item = c.abi.find((i) => i.type === "function" && i.name === c.functionName)
  const inputs = item?.type === "function" ? item.inputs : []
  return `${c.functionName}(${inputs.map((i) => `${i.type}${i.name ? ` ${i.name}` : ""}`).join(", ")})`
}

function namedArgs(c: Call): Record<string, unknown> {
  const item = c.abi.find((i) => i.type === "function" && i.name === c.functionName)
  const inputs = item?.type === "function" ? item.inputs : []
  return Object.fromEntries(inputs.map((input, i) => [input.name || `arg${i}`, c.args[i]]))
}

function encode(c: Call): Hex {
  return encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args } as never)
}

/**
 * A revert, or a failed estimate, as one sentence naming the call. A custom error from core's
 * ABIs reads as what it means; a reason string is quoted; anything else is passed on as it is,
 * because it is not a revert, and the CLI reports it as an RPC failure.
 */
export function revertError(c: Call, from: Address, err: unknown): Error {
  if (!(err instanceof BaseError)) return err instanceof Error ? err : new Error(String(err))
  const what = `${c.contract}.${c.functionName}`
  if (err.walk((e) => e instanceof InsufficientFundsError)) {
    return new SafenetError(`${from} does not hold enough ETH to pay the gas for ${what}`)
  }
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
  if (!(reverted instanceof ContractFunctionRevertedError)) return err
  const name = reverted.data?.errorName
  if (name && name !== "Error" && name !== "Panic") {
    return new SafenetError(`${what} would revert with ${name}: ${REVERT_REASONS[name] ?? "an error core's ABI does not explain"}`)
  }
  if (reverted.reason) return new SafenetError(`${what} would revert: "${reverted.reason}"`)
  return new SafenetError(`${what} would revert, and the contract gave no reason`)
}

export interface RunResult {
  readonly step: Step
  /** The logs of the receipt, or of the simulation in a dry run. Empty unless asked for there. */
  readonly logs: readonly Log[]
}

export interface Runner {
  readonly dryRun: boolean
  readonly from: Address
  /** The transactions run so far, in order. */
  readonly steps: readonly Step[]
  /** Runs one call after the ones before it. `logs` asks a dry run to simulate the logs too. */
  run(c: Call, options?: { readonly logs?: boolean }): Promise<RunResult>
}

/**
 * The runner for a mode. A live runner first checks that the endpoint is on Ethereum Mainnet:
 * the contracts in core are Mainnet's, and the same address elsewhere is someone else's.
 */
export async function createRunner(ctx: Context, mode: WriteMode, options: WriteOptions = {}): Promise<Runner> {
  if (mode.dryRun) return dryRunner(ctx, mode.from)
  const chainId = await ctx.client.getChainId()
  if (chainId !== 1) {
    throw new SafenetError(`The RPC endpoint is on chain ${chainId}, not Ethereum Mainnet, so nothing was sent`)
  }
  return liveRunner(ctx, mode.signer, options)
}

/** The step a call becomes, before or after it is sent. */
function stepOf(c: Call, gas: Figure<bigint>, transaction: SentTransaction | null): Step {
  return {
    contract: c.contract,
    to: c.address,
    function: signatureText(c),
    args: namedArgs(c),
    data: encode(c),
    gas,
    transaction,
  }
}

/** eth_call, then eth_estimateGas, against the chain as it stands. */
async function simulateAndEstimate(ctx: Context, c: Call, from: Address): Promise<bigint> {
  const request = { address: c.address, abi: c.abi, functionName: c.functionName, args: c.args, account: from }
  try {
    await ctx.client.simulateContract(request as never)
    return await ctx.client.estimateContractGas(request as never)
  } catch (err) {
    throw revertError(c, from, err)
  }
}

/** One call's result from eth_simulateV1, as far as a dry run reads it. */
interface SimulatedCall {
  readonly status: "success" | "failure"
  readonly gasUsed: bigint
  readonly logs?: readonly Log[] | undefined
  readonly error?: Error | undefined
}

function dryRunner(ctx: Context, from: Address): Runner {
  const steps: Step[] = []
  const prior: Call[] = []
  return {
    dryRun: true,
    from,
    steps,
    async run(c, options = {}) {
      let gas: Figure<bigint>
      let logs: readonly Log[] = []
      if (prior.length === 0) {
        gas = figure(await simulateAndEstimate(ctx, c, from), "eth_estimateGas")
      }
      if (prior.length > 0 || options.logs) {
        const calls = [...prior, c]
        let results: readonly SimulatedCall[]
        try {
          const [block] = await ctx.client.simulateBlocks({
            blocks: [{
              calls: calls.map((x) => ({
                account: from, to: x.address, abi: x.abi, functionName: x.functionName, args: x.args,
              })) as never,
            }],
          })
          results = (block?.calls ?? []) as readonly SimulatedCall[]
        } catch (err) {
          throw revertError(c, from, err)
        }
        const failed = results.findIndex((r) => r.status !== "success")
        if (failed !== -1) throw revertError(calls[failed] ?? c, from, results[failed]?.error)
        const last = results.at(-1)
        if (!last) throw new SafenetError(`eth_simulateV1 returned no result for ${c.contract}.${c.functionName}`)
        logs = last.logs ?? []
        gas ??= figure(
          last.gasUsed,
          `eth_simulateV1, gas used after step${prior.length === 1 ? "" : "s"} ${prior.map((_, i) => i + 1).join(", ")}; ` +
            "eth_estimateGas cannot see a step that is not sent",
        )
      }
      prior.push(c)
      const step = stepOf(c, gas!, null)
      steps.push(step)
      return { step, logs }
    },
  }
}

function liveRunner(ctx: Context, signer: Signer, options: WriteOptions): Runner {
  const steps: Step[] = []
  const from = signer.address
  /** One sentence, which names what is already on chain when a later step fails. */
  const fail = (err: unknown): never => {
    if (steps.length === 0) throw err
    const done = steps.map((s) => `${s.contract}.${s.function.split("(")[0]} in ${s.transaction?.hash}`).join(", ")
    const text = err instanceof Error ? err.message.split("\n")[0]!.replace(/\.$/, "") : String(err)
    throw new WriteError(`${text}; already confirmed, and not undone: ${done}`, [...steps])
  }
  return {
    dryRun: false,
    from,
    steps,
    async run(c) {
      let gas: bigint
      let hash: Hash
      try {
        gas = await simulateAndEstimate(ctx, c, from)
      } catch (err) {
        return fail(err)
      }
      try {
        hash = await signer.send({ to: c.address, data: encode(c), gas })
      } catch (err) {
        return fail(revertError(c, from, err))
      }
      options.onProgress?.({ type: "sent", contract: c.contract, functionName: c.functionName, hash })
      let receipt
      try {
        receipt = await ctx.client.waitForTransactionReceipt({ hash })
      } catch (err) {
        // The transaction may still land. Sending it again could do the operation twice.
        return fail(new SafenetError(
          `${c.contract}.${c.functionName} was sent in ${hash}, but its receipt could not be read ` +
            `(${err instanceof BaseError ? err.shortMessage : "no answer"}); look the hash up before sending again`,
        ))
      }
      const step = stepOf(c, figure(gas, "eth_estimateGas"), {
        hash,
        status: receipt.status,
        block: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      })
      if (receipt.status !== "success") {
        return fail(new SafenetError(`${c.contract}.${c.functionName} reverted on chain in ${hash}`))
      }
      steps.push(step)
      options.onProgress?.({ type: "confirmed", step })
      return { step, logs: receipt.logs }
    },
  }
}
