import { test } from "node:test"
import assert from "node:assert/strict"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { TestDatabase, noDatabase } from "./testing/database.js"
import { persistChronologyBatch } from "./archive.js"
import { initialChronology, memberCondition, type Chronology, type RoundEvent } from "./chronology.js"
import { poll, adapters } from "./poller.js"
import type { Env } from "./types.js"

const first = CONTRACTS.aegisFrostCoordinator.deployBlock
const signer = CONTRACTS.aegisConsensus.address.toLowerCase()
const newcomer = CONTRACTS.aegisFrostCoordinator.address.toLowerCase()
const staker = CONTRACTS.staking.address.toLowerCase()
const now = Math.floor(Date.now() / 1000)
const env: Env = { APP_ORIGIN: "https://app.test", DB: noDatabase }
const event = (offset: number, index: number, data: Partial<RoundEvent>): RoundEvent => ({
  kind: "share", block: (first + BigInt(offset)).toString(), index, time: now - 86400, ...data,
})
const checkpoint = async (db: TestDatabase) => (await db.state<Chronology>("aegis"))!
const count = async (db: TestDatabase, where = "true") =>
  (await db.query<{ n: number }>(`select count(*) as n from alerts_ceremonies where ${where}`))[0]!.n
const sids = async (db: TestDatabase) => (await db.query<{ sid: string }>("select sid from alerts_ceremonies order by sid")).map(row => row.sid)
async function lease(db: TestDatabase) {
  const holder = crypto.randomUUID()
  assert.equal(await db.lockRun(holder), true)
  return holder
}

test("over 10,000 unmatched ceremonies persist across restarts and an old winning share survives late attestation", async () => {
  const db = await TestDatabase.create()
  try {
    let holder = await lease(db)
    let state = initialChronology()
    for (let page = 0; page < 11; page++) {
      const events = Array.from({ length: 1000 }, (_, index) => event(page, index, {
        sid: `sid-${page * 1000 + index}`, root: "winner", participant: signer, staker,
      }))
      state = await persistChronologyBatch(db, holder, state, events, first + BigInt(page), `hash-${page}`, now)
      assert.deepEqual(state.pending, {})
      assert.deepEqual(await checkpoint(db), state)
      // A fresh poller loads only the checkpoint. It does not load the entire archive.
      await db.releaseRun(holder)
      holder = await lease(db)
      state = await checkpoint(db)
    }
    assert.equal(await count(db), 11_000)
    state = await persistChronologyBatch(db, holder, state, [
      event(100_000, 0, { kind: "completed", sid: "sid-0", root: "winner" }),
      event(100_000, 1, { kind: "attested", sid: "sid-0" }),
    ], first + 100_000n, "late", now)
    assert.deepEqual(state.rounds[0]!.present, [signer])
    assert.equal(memberCondition(state, staker, now)[0]!.misses, 0)
    assert.equal(memberCondition(state, staker, now)[0]!.participation, 100)
    assert.deepEqual(JSON.parse((await db.query<{ ceremony: string }>("select ceremony from alerts_ceremonies where sid = 'sid-0'"))[0]!.ceremony),
      { shares: {}, counted: true })
    assert.deepEqual(await checkpoint(db), state)
  } finally { await db.close() }
})

test("archive recovery preserves completion blocking, chronological order and attestation membership snapshots", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    let state = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "early", root: "winner", participant: signer, staker }),
      event(0, 1, { sid: "later", root: "loser", participant: signer }),
      event(0, 2, { kind: "completed", sid: "later", root: "winner" }),
    ], first, "one", now)
    state = await persistChronologyBatch(db, holder, state, [
      event(1, 0, { kind: "attested", sid: "early" }),
      event(1, 1, { kind: "member", participant: newcomer, staker }),
      event(1, 2, { kind: "attested", sid: "later" }),
    ], first + 1n, "two", now)
    assert.throws(() => memberCondition(state, staker, now), /incomplete/)
    assert.deepEqual(state.rounds, [])
    assert.deepEqual(state.pending.early!.at!.members, [signer])
    state = await persistChronologyBatch(db, holder, await checkpoint(db), [
      event(2, 0, { kind: "completed", sid: "early", root: "winner" }),
    ], first + 2n, "three", now)
    assert.deepEqual(state.rounds.map(r => r.sid), ["early", "later"])
    assert.equal(state.members[signer]!.misses, 1)
    assert.equal(state.members[newcomer]!.misses, 1)
    // Completing "early" also releases "later", although this batch has no event for it.
    assert.deepEqual(await db.loadCeremonies(holder, state.revision!, ["later", "unknown"]),
      { later: { shares: {}, counted: true }, unknown: null })
    state = await persistChronologyBatch(db, holder, state, [], first + 2000n, "pruned", now)
    assert.equal(state.counted.later, undefined)
    state = await persistChronologyBatch(db, holder, await checkpoint(db), [
      event(2001, 0, { kind: "attested", sid: "later" }),
    ], first + 2001n, "repeated", now)
    assert.deepEqual(state.pending, {})
    assert.deepEqual(state.rounds.map(r => r.sid), ["early", "later"])
  } finally { await db.close() }
})

test("one completion archives every newly released round beyond the input-event batch limit", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    let state = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { kind: "attested", sid: "blocked" }),
    ], first, "blocked", now)
    for (let page = 0; page < 3; page++) {
      const events = Array.from({ length: 400 }, (_, i) => `queued-${page * 400 + i}`).flatMap((sid, i) => [
        event(page + 1, i * 2, { kind: "completed", sid, root: "winner" }),
        event(page + 1, i * 2 + 1, { kind: "attested", sid }),
      ])
      state = await persistChronologyBatch(db, holder, state, events, first + BigInt(page + 1), `page-${page}`, now)
    }
    assert.equal(Object.keys(state.pending).length, 1201)
    state = await persistChronologyBatch(db, holder, state, [
      event(4, 0, { kind: "completed", sid: "blocked", root: "winner" }),
    ], first + 4n, "released", now)
    assert.equal(state.rounds.length, 1201)
    assert.deepEqual(state.pending, {})
    assert.equal(await count(db, "json_type(ceremony, '$.counted') is not null"), 1201)
    assert.deepEqual(await checkpoint(db), state)
  } finally { await db.close() }
})

test("a checkpoint above D1's 2 MB row limit is stored in parts and reads back whole", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    // Attestations without a completion stay pending in the checkpoint. Non-ASCII SIDs test the part boundaries.
    let state = initialChronology()
    for (let page = 0; page < 3; page++) {
      const blocked = Array.from({ length: 1000 }, (_, i) => event(page, i, { kind: "attested", sid: `blocked-${page}-${i}-${"é".repeat(300)}` }))
      state = await persistChronologyBatch(db, holder, state, blocked, first + BigInt(page), `large-${page}`, now)
    }
    assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength > 2_000_000)
    assert.ok((await db.query("select part from alerts_state where key = 'aegis'")).length > 2)
    assert.deepEqual(await checkpoint(db), state)
  } finally { await db.close() }
})

test("the generic state write refuses the checkpoint, and the archive refuses a malformed ceremony", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    await assert.rejects(db.saveState("aegis", initialChronology()), /atomic/)
    const next = { ...initialChronology(), revision: 1 }
    for (const ceremony of [{ shares: {}, at: { block: "1", index: 0, time: 0, members: [] } }, { shares: [] }, { shares: { r: ["x".repeat(70_000)] } }]) {
      await assert.rejects(db.saveChronology(holder, 0, next, { bad: ceremony as never }, []), /invalid chronology batch/)
    }
    assert.equal(await db.state("aegis"), undefined)
    assert.equal(await count(db), 0)
  } finally { await db.close() }
})

test("archive write failure rolls back deletions and checkpoint, and the poller sends no false attendance alerts", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer, staker }),
    ], first, "before", now)
    await db.releaseRun(holder)
    await db.query(`create trigger reject_archive before insert on alerts_ceremonies
      begin select raise(abort, 'archive unavailable'); end`)
    await db.subscribe(staker, "test", { triggers: ["missed", "participation"], missed: 1, participation: 100,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} } }, "test")
    let sent = 0
    await poll(env, db, { ...adapters, telegramUpdates: async () => {},
      walletConditions: async () => ({ events: [], validators: [CONTRACTS.staking.address], failed: 0 }),
      advanceChronology: async (_env, state, database, owner) => ({ current: true, time: now,
        state: await persistChronologyBatch(database, owner, state, [
          event(1, 0, { kind: "completed", sid: "old", root: "winner" }),
          event(1, 1, { kind: "attested", sid: "old" }),
          event(1, 2, { sid: "new", root: "winner", participant: signer }),
          event(1, 3, { kind: "completed", sid: "miss", root: "winner" }),
          event(1, 4, { kind: "attested", sid: "miss" }),
        ], first + 1n, "after", now),
      }), sendEvent: async () => { sent++; return "accepted" },
    })
    assert.equal(sent, 0)
    assert.deepEqual(await checkpoint(db), before)
    assert.deepEqual(await sids(db), ["old"])
    assert.equal((await db.latestRun())!.ok, false)
  } finally { await db.close() }
})

test("incomplete recovery and stale owners or revisions cannot advance the checkpoint", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer }),
    ], first, "before", now)
    const events = [event(1, 0, { kind: "attested", sid: "old" })]
    const original = db.loadCeremonies.bind(db)
    db.loadCeremonies = async () => ({})
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /Incomplete ceremony recovery/)
    db.loadCeremonies = original
    await assert.rejects(persistChronologyBatch(db, holder, initialChronology(), events, first + 1n, "after", now), /revision/)
    await db.query("update alerts_lock set until_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')")
    const successor = await lease(db)
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /lease/)
    assert.deepEqual(await checkpoint(db), before)
    await assert.rejects(db.saveChronology(holder, 1, { ...before, revision: 2 }, {}, ["old"]), /lease/)
    // A cursor behind the stored checkpoint never commits.
    await assert.rejects(db.saveChronology(successor, 1, { ...before, revision: 2, cursor: (first - 5n).toString() }, {}, []), /invalid chronology batch/)
    // Two writers with the same lease and snapshot still cannot commit twice.
    const outcomes = await Promise.allSettled([1, 2].map(() => persistChronologyBatch(db, successor, before, events, first + 1n, "after", now)))
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1)
    assert.equal((await checkpoint(db)).revision, 2)
    assert.deepEqual(await db.query("select revision, cursor from alerts_chronology"), [{ revision: 2, cursor: Number(first + 1n) }])
  } finally { await db.close() }
})

test("checkpoint failure and lease expiry during commit roll back every archive mutation", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer }),
    ], first, "before", now)
    const events = [event(1, 0, { kind: "attested", sid: "old" }),
      event(1, 1, { sid: "new", root: "winner", participant: signer })]
    await db.query(`create trigger reject_checkpoint before insert on alerts_state
      begin select raise(abort, 'checkpoint unavailable'); end`)
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /Database operation failed/)
    assert.deepEqual(await checkpoint(db), before)
    assert.deepEqual(await sids(db), ["old"])
    await db.query("drop trigger reject_checkpoint")
    await db.query(`create trigger expire_lease before insert on alerts_ceremonies
      begin update alerts_lock set until_at = '2000-01-01T00:00:00.000Z'; end`)
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /lease lost/)
    assert.deepEqual(await checkpoint(db), before)
    assert.deepEqual(await sids(db), ["old"])
  } finally { await db.close() }
})

test("counted SID tombstones survive pruning and restart without blocking later or delayed first attestations", async () => {
  const db = await TestDatabase.create()
  try {
    const holder = await lease(db)
    let state = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { kind: "member", participant: signer, staker }),
      event(0, 1, { sid: "counted", root: "winner", participant: signer }),
      event(0, 2, { kind: "completed", sid: "counted", root: "winner" }),
      event(0, 3, { kind: "attested", sid: "counted" }),
      event(0, 4, { sid: "delayed", root: "winner", participant: signer }),
    ], first, "first", now)
    assert.equal(state.rounds.length, 1)
    state = await persistChronologyBatch(db, holder, state, [], first + 1001n, "pruned", now)
    assert.equal(state.counted.counted, undefined)
    state = await checkpoint(db)
    state = await persistChronologyBatch(db, holder, state, [
      event(1002, 0, { kind: "attested", sid: "counted" }),
      event(1002, 1, { kind: "completed", sid: "delayed", root: "winner" }),
      event(1002, 2, { kind: "attested", sid: "delayed" }),
      event(1002, 3, { sid: "later", root: "winner", participant: signer }),
      event(1002, 4, { kind: "completed", sid: "later", root: "winner" }),
      event(1002, 5, { kind: "attested", sid: "later" }),
    ], first + 1002n, "repeated", now)
    assert.deepEqual(state.rounds.map(r => r.sid), ["counted", "delayed", "later"])
    assert.ok(state.rounds.every(r => r.present.length === 1 && r.present[0] === signer))
    assert.deepEqual(state.pending, {})
    assert.equal(memberCondition(state, staker, now)[0]!.participation, 100)
    assert.equal(memberCondition(state, staker, now)[0]!.misses, 0)
    const rows = await db.query<{ ceremony: string }>("select ceremony from alerts_ceremonies")
    assert.equal(rows.length, 3)
    assert.ok(rows.every(row => (JSON.parse(row.ceremony) as { counted?: boolean }).counted))
  } finally { await db.close() }
})
