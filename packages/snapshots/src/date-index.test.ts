import assert from "node:assert/strict"
import { test } from "node:test"
import { addDay, emptyIndex, INDEX_SCHEMA, parseIndex, type IndexEntry } from "./date-index.js"
import { serialise } from "./write.js"

const cid = (c: string) => `bafybei${c.repeat(52)}`
const entry = (c: string): IndexEntry => ({
  cid: cid(c), schema: "safenet-snapshot/1", mainnetBlock: "1", gnosisBlock: "2", blockTime: "2026-10-27T00:00:00.000Z", commit: null,
})

test("the first day starts an index with no previous version", () => {
  const u = addDay(emptyIndex(), null, "2026-10-27", entry("a"), { replace: false })
  assert.equal(u.kind, "added")
  if (u.kind !== "added") return
  assert.deepEqual(u.index, { schema: INDEX_SCHEMA, previous: null, days: { "2026-10-27": entry("a") } })
})

test("a new day names the index it extends, and days stay in date order", () => {
  const first = addDay(emptyIndex(), null, "2026-10-28", entry("a"), { replace: false })
  if (first.kind !== "added") throw new Error("not added")
  const second = addDay(first.index, cid("p"), "2026-10-27", entry("b"), { replace: false })
  if (second.kind !== "added") throw new Error("not added")
  assert.equal(second.index.previous, cid("p"))
  assert.deepEqual(Object.keys(second.index.days), ["2026-10-27", "2026-10-28"])
})

test("a day already in the index is never replaced", () => {
  const first = addDay(emptyIndex(), null, "2026-10-27", entry("a"), { replace: false })
  if (first.kind !== "added") throw new Error("not added")
  const again = addDay(first.index, cid("p"), "2026-10-27", entry("b"), { replace: false })
  assert.deepEqual(again, { kind: "already published", cid: cid("a") })
})

test("the preview index replaces a day, and says what it replaced", () => {
  const first = addDay(emptyIndex(), null, "2026-10-27", entry("a"), { replace: false })
  if (first.kind !== "added") throw new Error("not added")
  const again = addDay(first.index, cid("p"), "2026-10-27", entry("b"), { replace: true })
  assert.equal(again.kind, "replaced")
  if (again.kind !== "replaced") return
  assert.equal(again.was, cid("a"))
  assert.equal(again.index.days["2026-10-27"]!.cid, cid("b"))
})

test("a day or a CID of the wrong form is refused", () => {
  assert.throws(() => addDay(emptyIndex(), null, "27-10-2026", entry("a"), { replace: false }), /not a UTC day/)
  assert.throws(() => addDay(emptyIndex(), null, "2026-10-27", { ...entry("a"), cid: "Qm123" }, { replace: false }), /not a CIDv1/)
})

test("an index read back from the branch round-trips", () => {
  const u = addDay(emptyIndex(), null, "2026-10-27", entry("a"), { replace: false })
  if (u.kind !== "added") throw new Error("not added")
  assert.deepEqual(parseIndex(serialise(u.index)), u.index)
})

test("impossible calendar days cannot enter or survive a date index", () => {
  for (const day of ["2026-02-30", "2026-02-29", "2026-13-45", "2026-00-01", "2026-04-31"]) {
    assert.throws(() => addDay(emptyIndex(), null, day, entry("a"), { replace: false }), /not a UTC day/)
    assert.throws(() => parseIndex(serialise({ ...emptyIndex(), days: { [day]: entry("a") } })), /not a valid UTC day/)
  }
  const leap = addDay(emptyIndex(), null, "2028-02-29", entry("a"), { replace: false })
  assert.equal(leap.kind, "added")
  if (leap.kind === "added") assert.deepEqual(parseIndex(serialise(leap.index)), leap.index)
})

test("an index of another schema, or with a broken entry, is refused rather than extended", () => {
  assert.throws(() => parseIndex("{"), /not valid JSON/)
  assert.throws(() => parseIndex(JSON.stringify({ schema: "other", previous: null, days: {} })), /has schema "other"/)
  assert.throws(() => parseIndex(JSON.stringify({ schema: INDEX_SCHEMA, previous: null, days: { "2026-10-27": {} } })), /has no CID/)
  assert.throws(() => parseIndex(JSON.stringify({ schema: INDEX_SCHEMA, previous: "x", days: {} })), /neither null nor a CID/)
})
