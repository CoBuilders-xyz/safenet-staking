import { test } from "node:test"
import assert from "node:assert/strict"
import { attributeRewardClaims, compareRewardPeriodEnds, rewardPeriodWindows, RewardPeriodDataError } from "./reward-periods.js"

const period = (n: number, block = n * 100) => ({ period: n, blockNumber: String(block), timestamp: String(block) })
const claim = (block: number, amount: number, cumulative: number) => ({
  blockNumber: String(block), amount: String(amount), cumulativeAmount: String(cumulative),
})
const windows = () => rewardPeriodWindows([period(1), period(2), period(3)], 400n, 3)

test("whole-block attribution includes both sides of a same-block root update, regardless of query tie order", () => {
  const rows = attributeRewardClaims(windows(), [claim(200, 20, 30), claim(200, 10, 10), claim(399, 1, 31)])
  assert.deepEqual(rows.map((r) => [r.startBlock, r.endBlock, r.claims, r.claimed, r.subgraph]), [
    [100n, 199n, 0, 0n, 0n], [200n, 299n, 2, 30n, 30n], [300n, 400n, 1, 1n, 31n],
  ])
  assert.deepEqual(compareRewardPeriodEnds(rows, [0n, 30n, 31n]).map((c) => c.match), [true, true, true])
})

test("bounded history matches the complete history suffix, including a nonzero baseline and an empty middle window", () => {
  const claims = [claim(150, 7, 7), claim(400, 11, 18)]
  const all = attributeRewardClaims(windows(), claims)
  const suffix = attributeRewardClaims(rewardPeriodWindows([period(2), period(3)], 400n, 3, 2), claims.slice(1), 7n)
  assert.deepEqual(suffix, all.slice(1))
  assert.deepEqual(suffix.map((r) => [r.claimed, r.subgraph]), [[0n, 7n], [11n, 18n]])
})

test("empty claims preserve the starting cumulative amount; missing final claims remain mismatches", () => {
  const rows = attributeRewardClaims(windows(), [], 7n)
  assert.deepEqual(rows.map((r) => [r.claims, r.claimed, r.subgraph]), Array.from({ length: 3 }, () => [0, 0n, 7n]))
  assert.deepEqual(compareRewardPeriodEnds(rows, [7n, 7n, 8n]).map((c) => c.match), [true, true, false])
  assert.throws(() => compareRewardPeriodEnds(rows, [7n]), RewardPeriodDataError)
})

for (const [name, periods, total] of [
  ["missing distribution", [period(1), period(3)], 3],
  ["duplicate sequence", [period(1), period(1)], 2],
  ["same-block updates", [period(1), period(2, 100)], 2],
  ["backward boundary", [period(1, 200), period(2, 100)], 2],
  ["future boundary", [period(1, 401)], 1],
  ["zero boundary", [period(1, 0)], 1],
  ["malformed boundary", [{ ...period(1), blockNumber: "provider-private-marker" }], 1],
  ["malformed timestamp", [{ ...period(1), timestamp: "invalid" }], 1],
  ["overflowing date", [{ ...period(1), timestamp: "9007199254740991" }], 1],
  ["negative timestamp", [{ ...period(1), timestamp: "-1" }], 1],
  ["missing count", [period(1)], null],
  ["fractional count", [period(1)], 1.5],
  ["empty distributions", [], 0],
] as const) {
  test(`rejects ${name}`, () => {
    assert.throws(() => rewardPeriodWindows(periods, 400n, total), (error: unknown) => {
      assert.ok(error instanceof RewardPeriodDataError)
      assert.doesNotMatch(error.message, /provider-private-marker/)
      return true
    })
  })
}

for (const [name, claims] of [
  ["missing prefix", [claim(200, 20, 30)]],
  ["duplicate payment", [claim(200, 10, 10), claim(200, 10, 10)]],
  ["before window", [claim(99, 10, 10)]],
  ["after head", [claim(401, 10, 10)]],
  ["negative payment", [claim(200, -10, -10)]],
  ["malformed amount", [{ ...claim(200, 10, 10), amount: "" }]],
  ["fractional cumulative", [{ ...claim(200, 10, 10), cumulativeAmount: "10.5" }]],
] as const) {
  test(`rejects ${name}`, () => assert.throws(() => attributeRewardClaims(windows(), claims), RewardPeriodDataError))
}

test("bounded prefixes must start from the supplied archive baseline", () => {
  assert.throws(() => attributeRewardClaims(windows(), [claim(200, 10, 10)], 5n), RewardPeriodDataError)
  assert.throws(() => attributeRewardClaims(windows(), [], -1n), RewardPeriodDataError)
})

test("identity checks reject duplicate IDs, foreign accounts and missing identities", () => {
  const first = { ...claim(150, 10, 10), id: "a", account: "account" }
  const second = { ...claim(200, 20, 30), id: "b", account: "ACCOUNT" }
  assert.equal(attributeRewardClaims(windows(), [first, second], 0n, "account")[1]!.claimed, 20n)
  for (const bad of [{ ...second, id: "a" }, { ...second, account: "other" }, claim(200, 20, 30)]) {
    assert.throws(() => attributeRewardClaims(windows(), [first, bad], 0n, "account"), RewardPeriodDataError)
  }
})
