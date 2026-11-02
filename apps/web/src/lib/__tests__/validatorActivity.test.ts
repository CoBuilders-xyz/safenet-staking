import { describe, it, expect } from "vitest"
import { buildHistory, delegatorSeries, type StakeRow, type ValidatorRow, type WithdrawalRow } from "../validatorActivity"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"

const DAY = 86_400
const D0 = 1_774_569_600 // 2026-03-27 00:00 UTC
const ALICE = TEST_ACCOUNTS.user.toLowerCase()
const BOB = TEST_ACCOUNTS.validator2.toLowerCase()
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`

let n = 0
function stake(staker: string, amount: bigint, at: number, block = 24_800_000 + at - D0): StakeRow {
  n++
  return { id: `${hash(n)}-${n}`, staker, amount: amount.toString(), blockNumber: String(block), timestamp: String(at), transactionHash: hash(n) }
}
function withdrawal(id: string, staker: string, amount: bigint, at: number, claimedAt?: number): WithdrawalRow {
  return {
    id,
    staker,
    amount: amount.toString(),
    claimed: claimedAt !== undefined,
    initiatedAtBlock: String(24_800_000 + at - D0),
    initiatedAtTimestamp: String(at),
    initiatedTxHash: hash(1000 + Number(id)),
    claimedAtBlock: claimedAt === undefined ? null : String(24_800_000 + claimedAt - D0),
    claimedAtTimestamp: claimedAt === undefined ? null : String(claimedAt),
    claimedTxHash: claimedAt === undefined ? null : hash(2000 + Number(id)),
  }
}
const validator: ValidatorRow = {
  id: TEST_ACCOUNTS.validator1.toLowerCase(),
  isRegistered: true,
  totalStaked: "0",
  stakersCurrent: 1,
  stakersEver: 2,
  firstSeenAtBlock: "24741800",
  firstSeenAtTimestamp: "1774528907",
  registeredAtBlock: "24741826",
  registeredAtTimestamp: "1774529219",
}

describe("buildHistory", () => {
  it("lists registration, stakes, unstakes and claims, newest first, each with a unique id", () => {
    const events = buildHistory(validator, [stake(ALICE, 5n, D0)], [withdrawal("7", ALICE, 5n, D0 + DAY, D0 + 8 * DAY)])
    expect(events.map((e) => e.kind)).toEqual(["withdrawal-claimed", "withdrawal-initiated", "stake", "registered"])
    expect(new Set(events.map((e) => e.id)).size).toBe(4)
    const registered = events[3]
    expect(registered).toMatchObject({ block: 24_741_826n, timestamp: 1_774_529_219 })
    expect("txHash" in registered).toBe(false)
  })

  it("uses first-seen without inventing a registration or an unclaimed withdrawal", () => {
    const events = buildHistory({ ...validator, registeredAtBlock: null, registeredAtTimestamp: null }, [], [withdrawal("8", BOB, 1n, D0)])
    expect(events.map((e) => e.kind)).toEqual(["withdrawal-initiated", "first-seen"])
    expect(events[1]).toEqual({ kind: "first-seen", id: "first-seen-24741800", block: 24_741_800n, timestamp: 1_774_528_907 })
  })

  it.each(["registeredAtBlock", "registeredAtTimestamp"] as const)("uses a complete first-seen pair when %s is null", (field) => {
    const events = buildHistory({ ...validator, [field]: null }, [], [])
    expect(events).toEqual([{ kind: "first-seen", id: "first-seen-24741800", block: 24_741_800n, timestamp: 1_774_528_907 }])
  })

  it("is empty for an address the subgraph has no record of", () => {
    expect(buildHistory(null, [], [])).toEqual([])
  })
})

describe("delegatorSeries", () => {
  it("counts addresses with a non-zero position at the end of each day", () => {
    const series = delegatorSeries(
      [stake(ALICE, 10n, D0), stake(BOB, 5n, D0 + DAY), stake(ALICE, 1n, D0 + 2 * DAY)],
      [withdrawal("1", ALICE, 4n, D0 + 2 * DAY), withdrawal("2", BOB, 5n, D0 + 3 * DAY)],
    )
    expect(series.points).toEqual([
      { day: D0, current: 1, ever: 1 },
      { day: D0 + DAY, current: 2, ever: 2 },
      // A partial unstake keeps Alice; a top-up does not count her twice.
      { day: D0 + 2 * DAY, current: 2, ever: 2 },
      // Bob's whole stake leaves when the unstake starts, not when it is claimed.
      { day: D0 + 3 * DAY, current: 1, ever: 2 },
    ])
    expect([series.current, series.ever]).toEqual([1, 2])
  })

  it("does not depend on the order of a day's events", () => {
    // Out of order within the day: the full unstake listed before the stake that funds it.
    const series = delegatorSeries([stake(ALICE, 3n, D0 + 600)], [withdrawal("3", ALICE, 3n, D0 + 60)])
    expect(series.points).toEqual([{ day: D0, current: 0, ever: 1 }])
  })

  it("counts an address that leaves and comes back once, in both counts", () => {
    const series = delegatorSeries([stake(ALICE, 3n, D0), stake(ALICE, 2n, D0 + 2 * DAY)], [withdrawal("4", ALICE, 3n, D0 + DAY)])
    expect(series.points.map((p) => p.current)).toEqual([1, 0, 1])
    expect(series.ever).toBe(1)
  })

  it("is empty with no stake", () => {
    expect(delegatorSeries([], [])).toEqual({ points: [], current: 0, ever: 0 })
  })
})
