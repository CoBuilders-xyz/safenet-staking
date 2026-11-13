import { describe, expect, it } from "vitest"
import { AEGIS_START_DAY, BETA_FINAL_REWARDS_TOKEN_TOTAL, utcDayMs } from "@cobuilders/safenet-core"
import { APR_METHOD, estimateApr, type AprInputs } from "../estimatedApr"

const SAFE = 10n ** 18n
const DAY = 86_400
const START = utcDayMs(AEGIS_START_DAY) / 1000
const day = (n: number) => START + n * DAY

/** SEF's first Aegis file, as the dataset behind rewards.safenet-gov.eth served it on 2026-11-11. */
const FIRST_AEGIS = {
  rewardsUntil: "2026-10-27T00:00:00.000Z",
  tokenTotal: "4723064697884593348124545",
  sentinelTokenTotal: "30769230769230769230768",
}

/** The Mainnet subgraph's rows for that period, read on 2026-11-11, in wei: quiet days have none. */
const REAL_DAYS = [
  ["2026-10-12", "73348101287952461676326820"],
  ["2026-10-13", "72936757297984572542607163"],
  ["2026-10-14", "69126616952885861854100899"],
  ["2026-10-15", "69553372205116522368801960"],
  ["2026-10-16", "68546938685171953309411423"],
  ["2026-10-17", "68548032846051322190352108"],
  ["2026-10-18", "68551776457077024018643887"],
  ["2026-10-19", "68455855086832961726170438"],
  ["2026-10-20", "62773192604549316806760869"],
  ["2026-10-21", "64117747479109009240843314"],
  ["2026-10-22", "64198410936133150208459924"],
  ["2026-10-23", "64911993337386227900504317"],
  ["2026-10-24", "69550090570426397066179577"],
  ["2026-10-26", "69555583211255109215240029"],
].map(([d, totalStaked]) => ({ date: Date.parse(`${d}T00:00:00Z`) / 1000, totalStaked: totalStaked! }))

const NOW = Date.UTC(2026, 10, 11, 12)

function inputs(over: Partial<AprInputs> = {}): AprInputs {
  return { latest: FIRST_AEGIS, days: REAL_DAYS, indexedAt: NOW / 1000 - 60, now: NOW, ...over }
}

/** A period of flat stake: the APR is then exactly rewards / stake × 365 / 14. */
const flat = (stake: bigint) => [{ date: day(0), totalStaked: (stake * SAFE).toString() }]

/** A file `periods` Aegis periods in, with SEP 56's allocation per period and sentinels' on top. */
function aegisFile(periods: number, perPeriod = APR_METHOD.expectedPerPeriod, sentinelPerPeriod = 30_769n * SAFE) {
  return {
    rewardsUntil: new Date((START + periods * 14 * DAY) * 1000).toISOString(),
    tokenTotal: (BETA_FINAL_REWARDS_TOKEN_TOTAL + (perPeriod + sentinelPerPeriod) * BigInt(periods)).toString(),
    sentinelTokenTotal: (sentinelPerPeriod * BigInt(periods)).toString(),
  }
}

describe("estimateApr", () => {
  it("gives 7.39% for the first Aegis period, from SEF's file and the subgraph's daily stake", () => {
    const result = estimateApr(inputs())
    if (!result.ok) throw new Error(result.reason)
    expect(result.apr).toBeCloseTo(0.07386, 5)
    expect(result.periodStart).toBe(day(0))
    expect(result.periodEnd).toBe(day(14))
    // 5,000,000 SAFE over 26 periods, 500 wei short.
    expect(result.rewards).toBe(192_307_692_307_692_307_691_807n)
    expect(result.averageStaked / SAFE).toBe(67_884_032n)
  })

  it("annualizes by the period length, without compounding", () => {
    const result = estimateApr(inputs({ days: flat(70_000_000n) }))
    if (!result.ok) throw new Error(result.reason)
    // 192,307.69 / 70,000,000 × 365 / 14 = 0.0716...; compounded 26 times it would be 0.0742.
    expect(result.apr).toBeCloseTo((192_307.692307692 / 70_000_000) * (365 / 14), 10)
  })

  it("keeps precision for wei amounts far beyond 2^53", () => {
    // One wei of stake difference over 10^26 still resolves to the same 12-digit ratio.
    const a = estimateApr(inputs({ days: [{ date: day(0), totalStaked: (10n ** 26n).toString() }] }))
    const b = estimateApr(inputs({ days: [{ date: day(0), totalStaked: (10n ** 26n + 1n).toString() }] }))
    if (!a.ok || !b.ok) throw new Error("expected estimates")
    expect(a.apr).toBeCloseTo(b.apr, 12)
    expect(a.averageStaked).toBe(10n ** 26n)
  })

  it("carries a quiet day's stake forward, and ignores rows after the period", () => {
    const days = [
      { date: day(-30), totalStaked: (10_000_000n * SAFE).toString() },
      { date: day(7), totalStaked: (30_000_000n * SAFE).toString() },
      { date: day(14), totalStaked: (1n * SAFE).toString() },
    ]
    const result = estimateApr(inputs({ days }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.averageStaked).toBe(20_000_000n * SAFE)
  })

  it("takes the mean over Aegis periods once there are several", () => {
    const result = estimateApr(inputs({ latest: aegisFile(3), days: flat(50_000_000n), now: (START + 43 * DAY) * 1000, indexedAt: START + 43 * DAY }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.rewards).toBe(APR_METHOD.expectedPerPeriod)
    expect(result.periodStart).toBe(day(28))
  })

  it.each([
    ["a period that ends at no UTC midnight", { latest: { ...FIRST_AEGIS, rewardsUntil: "2026-10-27T06:00:00.000Z" } }, "invalidPeriodEnd"],
    ["a period end that is not a date", { latest: { ...FIRST_AEGIS, rewardsUntil: "soon" } }, "invalidPeriodEnd"],
    ["a period that has not ended", { now: Date.UTC(2026, 9, 26) }, "periodInFuture"],
    ["Beta's final file, as the mirror serves it", { latest: { rewardsUntil: "2026-10-06T00:00:00.000Z", tokenTotal: BETA_FINAL_REWARDS_TOKEN_TOTAL.toString() } }, "noPeriodYet"],
    ["a period that is not a whole number of periods into Aegis", { latest: { ...FIRST_AEGIS, rewardsUntil: "2026-10-28T00:00:00.000Z" } }, "misalignedPeriod"],
    ["a file 25 days after its period", { now: Date.UTC(2026, 10, 21) }, "stale"],
    ["a file with no sentinel total", { latest: { rewardsUntil: FIRST_AEGIS.rewardsUntil, tokenTotal: FIRST_AEGIS.tokenTotal } }, "noSentinelTotal"],
    ["a sentinel total larger than the Aegis rewards", { latest: { ...FIRST_AEGIS, sentinelTokenTotal: FIRST_AEGIS.tokenTotal } }, "noRewards"],
    ["a malformed amount", { latest: { ...FIRST_AEGIS, tokenTotal: "1.5" } }, "invalidAmount"],
    ["a malformed daily stake", { days: [{ date: day(0), totalStaked: "-1" }] }, "invalidAmount"],
    ["a subgraph that has not indexed the period's end", { indexedAt: day(14) - 1 }, "notIndexed"],
    ["a subgraph with no indexed block", { indexedAt: undefined }, "notIndexed"],
    ["no stake recorded at or before the period's first day", { days: REAL_DAYS.slice(2) }, "noStakeBeforePeriod"],
    ["no daily rows", { days: [] }, "noStakeBeforePeriod"],
    ["zero stake through the period", { days: flat(0n) }, "noStake"],
  ] as const)("withholds the figure for %s", (_, over, reason) => {
    expect(estimateApr(inputs(over as Partial<AprInputs>))).toEqual({ ok: false, reason })
  })

  it("withholds the figure when the rewards stray more than 1% from SEP 56's allocation", () => {
    const now = (START + 15 * DAY) * 1000
    const per = APR_METHOD.expectedPerPeriod
    expect(estimateApr(inputs({ latest: aegisFile(1, per + per / 101n), now })).ok).toBe(true)
    expect(estimateApr(inputs({ latest: aegisFile(1, per + per / 99n), now }))).toEqual({ ok: false, reason: "outsideBudget" })
    expect(estimateApr(inputs({ latest: aegisFile(1, per - per / 99n), now }))).toEqual({ ok: false, reason: "outsideBudget" })
  })

  it("withholds the figure when the sentinel total turns out to be per period, not cumulative", () => {
    // Two periods in, a per-period sentinel figure leaves one period's sentinel rewards in the mean: ~8% high.
    const file = aegisFile(2)
    const perPeriodSentinel = { ...file, sentinelTokenTotal: (30_769n * SAFE).toString() }
    expect(estimateApr(inputs({ latest: perPeriodSentinel, now: (START + 29 * DAY) * 1000, days: flat(60_000_000n) }))).toEqual({
      ok: false,
      reason: "outsideBudget",
    })
  })

  it("takes its parameters from the method, so the method can change in one place", () => {
    const result = estimateApr(inputs({ days: flat(70_000_000n) }), { ...APR_METHOD, daysPerYear: 364 })
    if (!result.ok) throw new Error(result.reason)
    expect(result.apr).toBeCloseTo((192_307.692307692 / 70_000_000) * 26, 10)
  })
})
