/** `safenet validators list` and `safenet validators show`. */
import { getAddress, type Address } from "viem"
import { CONTRACTS, indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { figure, type Figure } from "./figure.js"
import { ScanError, scanLogs } from "./scan.js"
import { fetchValidatorsWithWindow, type ParticipationWindow, type SefValidator } from "./sef.js"

export interface Validator {
  readonly address: Address
  /** Null when SEF's file does not list the address. */
  readonly label: string | null
  /** SEF's is_active. Null when SEF's file does not list the address. */
  readonly active: boolean | null
  /** Staking.isValidator() on chain. */
  readonly registered: boolean
  /** A fraction, 0.05 for 5%. Null when SEF's file does not list the address. */
  readonly commission: number | null
  readonly stake: bigint
  /** stake / Staking.totalStakedAmount(), a fraction. */
  readonly share: number
  /**
   * SEF's participation_rate_14d, a fraction, over `window`. Null when SEF does not list the
   * address, or lists it and publishes no rate.
   */
  readonly participation: number | null
}

export const VALIDATOR_SOURCES = {
  label: "SEF: validator-info.json label",
  active: "SEF: validator-info.json is_active",
  registered: "chain: Staking.isValidator()",
  commission: "SEF: validator-info.json commission",
  stake: "chain: Staking.totalValidatorStakes()",
  share: "chain: Staking.totalValidatorStakes() / Staking.totalStakedAmount()",
  participation: "SEF: validator-info.json participation_rate_14d",
} as const

export type ValidatorFilter = "active" | "all"
export type ValidatorSort = "stake" | "participation"

export interface ValidatorList {
  readonly block: bigint
  readonly filter: ValidatorFilter
  readonly sort: ValidatorSort
  readonly window: ParticipationWindow
  readonly totalStaked: Figure<bigint>
  readonly validators: readonly Validator[]
  readonly sources: typeof VALIDATOR_SOURCES
}

/** Share as a fraction, without routing 1e25-wei values through a float first. */
const shareOf = (part: bigint, whole: bigint) =>
  whole === 0n ? 0 : Number((part * 1_000_000_000n) / whole) / 1_000_000_000

async function readValidators(
  ctx: Context,
  listed: readonly SefValidator[],
  extra: readonly Address[],
): Promise<{ block: bigint; totalStaked: bigint; validators: Validator[] }> {
  const { client } = ctx
  const staking = CONTRACTS.staking.address
  const blockNumber = await client.getBlockNumber()
  const addresses = [...listed.map((v) => getAddress(v.address)), ...extra]
  const [totalStaked, stakes, registered] = await Promise.all([
    client.readContract({ address: staking, abi: stakingAbi, functionName: "totalStakedAmount", blockNumber }),
    Promise.all(addresses.map((a) =>
      client.readContract({ address: staking, abi: stakingAbi, functionName: "totalValidatorStakes", args: [a], blockNumber }))),
    Promise.all(addresses.map((a) =>
      client.readContract({ address: staking, abi: stakingAbi, functionName: "isValidator", args: [a], blockNumber }))),
  ])
  const validators = addresses.map((address, i): Validator => {
    const sef = listed[i]
    const stake = stakes[i] ?? 0n
    return {
      address,
      label: sef?.label ?? null,
      active: sef?.is_active ?? null,
      registered: registered[i] ?? false,
      commission: sef?.commission ?? null,
      stake,
      share: shareOf(stake, totalStaked),
      participation: sef?.participation_rate_14d ?? null,
    }
  })
  return { block: blockNumber, totalStaked, validators }
}

export function sortValidators(validators: readonly Validator[], sort: ValidatorSort): Validator[] {
  return [...validators].sort((a, b) => {
    if (sort === "participation") return (b.participation ?? -1) - (a.participation ?? -1)
    return b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0
  })
}

export async function listValidators(
  ctx: Context,
  options: { filter: ValidatorFilter; sort: ValidatorSort },
): Promise<ValidatorList> {
  const { validators: listed, window } = await fetchValidatorsWithWindow(ctx)
  const { block, totalStaked, validators } = await readValidators(ctx, listed, [])
  const kept = options.filter === "all" ? validators : validators.filter((v) => v.active === true)
  return {
    block,
    filter: options.filter,
    sort: options.sort,
    window,
    totalStaked: figure(totalStaked, "chain: Staking.totalStakedAmount()"),
    validators: sortValidators(kept, options.sort),
    sources: VALIDATOR_SOURCES,
  }
}

export interface ValidatorDetail {
  readonly block: bigint
  readonly window: ParticipationWindow
  readonly validator: Validator
  /** Null, with the reason, when the log scan this count needs could not complete. */
  readonly delegators: Figure<{ current: number; ever: number } | null> & { readonly unavailableBecause?: string }
  readonly sources: typeof VALIDATOR_SOURCES
}

export async function showValidator(ctx: Context, address: Address): Promise<ValidatorDetail> {
  const { validators: all, window } = await fetchValidatorsWithWindow(ctx)
  const listed = all.filter((v) => v.address.toLowerCase() === address.toLowerCase())
  const { block, validators } = await readValidators(ctx, listed, listed.length ? [] : [address])
  const validator = validators[0]
  if (!validator || (listed.length === 0 && !validator.registered)) {
    throw new SafenetError(
      `${address} is not a validator: SEF's validator-info.json does not list it and Staking.isValidator() is false`,
    )
  }
  const delegators = await countDelegators(ctx, validator.address, block)
  return { block, window, validator, delegators, sources: VALIDATOR_SOURCES }
}

/**
 * Every staker that ever staked to the validator, then the ones whose stake is still above
 * zero, read from state rather than inferred from events. Needs a historical log scan, which
 * the public endpoints refuse; then the count is reported unavailable and the rest still prints.
 */
async function countDelegators(
  ctx: Context,
  validator: Address,
  block: bigint,
): Promise<Figure<{ current: number; ever: number } | null> & { unavailableBecause?: string }> {
  const staking = CONTRACTS.staking.address
  const source =
    `chain: StakeIncreased logs for this validator from block ${CONTRACTS.staking.deployBlock}, ` +
    `then Staking.stakes(staker, validator) > 0`
  let logs
  try {
    logs = await scanLogs(ctx, {
      address: staking,
      event: indexedEvent("staking", "StakeIncreased"),
      args: { validator },
      fromBlock: CONTRACTS.staking.deployBlock,
      toBlock: block,
    })
  } catch (err) {
    if (err instanceof ScanError) return { ...figure(null, source), unavailableBecause: err.message }
    throw err
  }
  const stakers = [...new Set(logs.map((l) => getAddress(l.args.staker!)))]
  const stakes = await Promise.all(stakers.map((s) =>
    ctx.client.readContract({
      address: staking, abi: stakingAbi, functionName: "stakes", args: [s, validator], blockNumber: block,
    })))
  return figure({ current: stakes.filter((s) => s > 0n).length, ever: stakers.length }, source)
}
