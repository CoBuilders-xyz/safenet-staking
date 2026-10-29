import { test } from "node:test"
import assert from "node:assert/strict"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { foldChronology, initialChronology, memberCondition, type RoundEvent } from "./chronology.js"

const signer = CONTRACTS.aegisConsensus.address.toLowerCase()
const other = CONTRACTS.aegisFrostCoordinator.address.toLowerCase()
const staker = CONTRACTS.staking.address.toLowerCase()
const first = CONTRACTS.aegisFrostCoordinator.deployBlock
const now = Math.floor(Date.now() / 1000)
function event(offset: number, index: number, data: Partial<RoundEvent>): RoundEvent {
  return { kind: "member", block: (first + BigInt(offset)).toString(), index, time: now - 86400, ...data }
}
function round(offset: number, sid: string, participant = other): RoundEvent[] {
  return [event(offset, 1, { kind: "share", sid, root: "winner", participant }),
    event(offset, 2, { kind: "completed", sid, root: "winner" }), event(offset, 3, { kind: "attested", sid })]
}

test("chronology counts consecutive misses, resets on winning attendance, ignores losing roots and non-attestations", () => {
  const events = [event(0, 0, { participant: signer, staker }),
    ...round(1, "one"), ...round(2, "two", signer),
    event(3, 0, { kind: "share", participant: signer, sid: "three", root: "loser" }), ...round(3, "three"),
    ...round(4, "four"), ...round(5, "non-attestation").filter(e => e.kind !== "attested")]
  const state = foldChronology(initialChronology(), events.reverse(), first + 5n, "checkpoint", now)
  const [condition] = memberCondition(state, staker, now)
  assert.equal(condition!.misses, 2) // Three total misses would be wrong.
  assert.equal(condition!.streakStart, "three")
  assert.equal(condition!.participation, 25)
  assert.equal(state.rounds.length, 4)
})
test("new members receive no retrospective consecutive misses; known absent members have zero participation", () => {
  const state = foldChronology(initialChronology(), [...round(0, "before"),
    event(1, 0, { participant: signer, staker }), ...round(1, "after")], first + 2n, "checkpoint", now)
  const [condition] = memberCondition(state, staker, now)
  assert.equal(condition!.misses, 1)
  assert.equal(condition!.participation, 0)
})
test("same-block log order matters for membership, duplicate shares do not increase attendance", () => {
  const state = foldChronology(initialChronology(), [...round(0, "first"),
    event(0, 4, { participant: signer, staker }), ...round(1, "second", signer),
    event(1, 1, { kind: "share", sid: "second", root: "winner", participant: signer })], first + 1n, "checkpoint", now)
  assert.equal(state.members[signer]!.misses, 0)
  assert.equal(state.rounds[1]!.present.length, 1)
})
test("incomplete earlier rounds block later streaks and resume correctly across polling boundaries", () => {
  const initial = foldChronology(initialChronology(), [event(0, 0, { participant: signer, staker }),
    event(0, 1, { kind: "attested", sid: "missing" }), ...round(1, "later")], first + 1n, "checkpoint", now)
  assert.throws(() => memberCondition(initial, staker, now), /incomplete/)
  assert.equal(initial.rounds.length, 0)
  const completed = foldChronology(initial, [event(2, 0, { kind: "completed", sid: "missing", root: "winner" })], first + 2n, "checkpoint2", now)
  assert.equal(memberCondition(completed, staker, now)[0]!.misses, 2)
  assert.equal(memberCondition(completed, staker, now)[0]!.streakStart, "missing")
  assert.throws(() => foldChronology(completed, [event(2, 0, {})], first + 3n, "x", now), /range/)
})
test("late shares and repeated attestations cannot rewrite counted rounds", () => {
  const initial = foldChronology(initialChronology(), [event(0, 0, { participant: signer, staker }), ...round(1, "first")], first + 1n, "x", now)
  const next = foldChronology(initial, [event(2, 0, { kind: "share", participant: signer, sid: "first", root: "winner" }),
    event(2, 1, { kind: "attested", sid: "first" })], first + 2n, "y", now)
  assert.equal(next.rounds.length, 1)
  assert.equal(next.members[signer]!.misses, 1)
})

test("a delayed attestation still uses retained winning shares instead of inventing a miss", () => {
  const initial = foldChronology(initialChronology(), [event(0, 0, { participant: signer, staker }),
    ...round(1, "delayed", signer).filter(e => e.kind !== "attested")], first + 1n, "x", now)
  // No verified maximum attestation delay exists in the indexed interface. Age alone cannot
  // justify deleting these shares: a later attestation must still count their attendance.
  const next = foldChronology(initial, [event(100_000, 0, { kind: "attested", sid: "delayed", time: now })], first + 100_000n, "y", now)
  assert.equal(next.members[signer]!.misses, 0)
  assert.deepEqual(next.rounds[0]!.present, [signer])
})
