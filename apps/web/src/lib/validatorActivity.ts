import type { ValidatorActivityQuery } from "@/graphql/mainnet/generated"

const DAY = 86_400

export type StakeRow = ValidatorActivityQuery["stakes"][number]
export type WithdrawalRow = ValidatorActivityQuery["withdrawals"][number]
export type ValidatorRow = NonNullable<ValidatorActivityQuery["validator"]>

interface At {
  /** Unique within one validator's history. */
  id: string
  block: bigint
  /** Unix seconds. */
  timestamp: number
}

/**
 * One entry of a validator's history, from what the Mainnet subgraph indexes. The registration
 * comes from the validator's own row, which keeps the block of its latest registration and not
 * the transaction, so it links to the block. The subgraph keeps no row per ValidatorUpdated event,
 * so a deregistration has no entry: the validator's state says it, undated.
 */
export type ValidatorEvent =
  | ({ kind: "registered" } & At)
  | ({ kind: "stake"; txHash: string; staker: string; amount: bigint } & At)
  | ({ kind: "withdrawal-initiated"; txHash: string; staker: string; amount: bigint; withdrawalId: string } & At)
  | ({ kind: "withdrawal-claimed"; txHash: string; staker: string; amount: bigint; withdrawalId: string } & At)

/** Newest first. */
export function buildHistory(
  validator: ValidatorRow | null,
  stakes: readonly StakeRow[],
  withdrawals: readonly WithdrawalRow[],
): ValidatorEvent[] {
  const events: ValidatorEvent[] = []
  if (validator?.registeredAtBlock && validator.registeredAtTimestamp) {
    events.push({ kind: "registered", id: `registered-${validator.registeredAtBlock}`, block: BigInt(validator.registeredAtBlock), timestamp: Number(validator.registeredAtTimestamp) })
  }
  for (const s of stakes) {
    events.push({
      kind: "stake",
      id: `stake-${s.id}`,
      block: BigInt(s.blockNumber),
      timestamp: Number(s.timestamp),
      txHash: s.transactionHash,
      staker: s.staker,
      amount: BigInt(s.amount),
    })
  }
  for (const w of withdrawals) {
    const common = { staker: w.staker, amount: BigInt(w.amount), withdrawalId: w.id }
    events.push({
      kind: "withdrawal-initiated",
      id: `withdrawal-${w.id}-initiated`,
      block: BigInt(w.initiatedAtBlock),
      timestamp: Number(w.initiatedAtTimestamp),
      txHash: w.initiatedTxHash,
      ...common,
    })
    if (w.claimed && w.claimedAtBlock && w.claimedAtTimestamp && w.claimedTxHash) {
      events.push({
        kind: "withdrawal-claimed",
        id: `withdrawal-${w.id}-claimed`,
        block: BigInt(w.claimedAtBlock),
        timestamp: Number(w.claimedAtTimestamp),
        txHash: w.claimedTxHash,
        ...common,
      })
    }
  }
  return events.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
}

export interface DelegatorPoint {
  /** Unix seconds of the UTC day's start. */
  day: number
  /** Addresses with a non-zero position at the end of the day. */
  current: number
  /** Addresses that had staked with the validator by the end of the day. */
  ever: number
}

export interface DelegatorSeries {
  /** One point per UTC day with a stake or a withdrawal, oldest first. */
  points: DelegatorPoint[]
  current: number
  ever: number
}

/**
 * Unique delegators per UTC day, replayed from the stakes and withdrawals, by the subgraph's own
 * rule: a position counts while its amount is above zero, and a withdrawal takes the amount out
 * when it is initiated, not when it is claimed. Within a day the order of events does not matter,
 * because only the amounts at the end of the day are counted.
 */
export function delegatorSeries(stakes: readonly StakeRow[], withdrawals: readonly WithdrawalRow[]): DelegatorSeries {
  const changes = [
    ...stakes.map((s) => ({ staker: s.staker.toLowerCase(), delta: BigInt(s.amount), at: Number(s.timestamp) })),
    ...withdrawals.map((w) => ({ staker: w.staker.toLowerCase(), delta: -BigInt(w.amount), at: Number(w.initiatedAtTimestamp) })),
  ]
  const byDay = new Map<number, typeof changes>()
  for (const c of changes) {
    const day = Math.floor(c.at / DAY) * DAY
    byDay.set(day, [...(byDay.get(day) ?? []), c])
  }

  const amounts = new Map<string, bigint>()
  const everStaked = new Set<string>()
  let current = 0
  const points: DelegatorPoint[] = []
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const dayChanges = byDay.get(day) ?? []
    const touched = new Set(dayChanges.map((c) => c.staker))
    const before = new Map([...touched].map((s) => [s, (amounts.get(s) ?? 0n) > 0n]))
    for (const c of dayChanges) {
      amounts.set(c.staker, (amounts.get(c.staker) ?? 0n) + c.delta)
      if (c.delta > 0n) everStaked.add(c.staker)
    }
    for (const s of touched) current += Number((amounts.get(s) ?? 0n) > 0n) - Number(before.get(s))
    points.push({ day, current, ever: everStaked.size })
  }
  return { points, current, ever: everStaked.size }
}
