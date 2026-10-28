import { strict as assert } from "node:assert"
import { test } from "node:test"
import { BETA_END_DAY, utcDayMs } from "../src/sef.js"
import { betaWindow } from "./metrics-window.js"

test("Beta's historical window ends after its last day, regardless of today's publication", () => {
  const { start, end } = betaWindow(14)
  assert.equal(end.getTime(), utcDayMs(BETA_END_DAY) + 86_400_000)
  assert.equal(end.getTime() - start.getTime(), 14 * 86_400_000)
  assert.equal(start.getUTCMinutes(), 0)
  assert.equal(end.getUTCMinutes(), 0)
  for (const invalid of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => betaWindow(invalid))
})
