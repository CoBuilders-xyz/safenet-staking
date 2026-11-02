import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { URL } from "node:url"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { SqlDatabase } from "./testing/database.js"
import { persistChronologyBatch } from "./archive.js"
import { initialChronology, memberCondition, type Chronology, type RoundEvent } from "./chronology.js"
import { poll, adapters } from "./poller.js"
import type { Env } from "./types.js"

const first = CONTRACTS.aegisFrostCoordinator.deployBlock
const signer = CONTRACTS.aegisConsensus.address.toLowerCase()
const newcomer = CONTRACTS.aegisFrostCoordinator.address.toLowerCase()
const staker = CONTRACTS.staking.address.toLowerCase()
const now = Math.floor(Date.now() / 1000)
const env: Env = { APP_ORIGIN: "https://app.test", SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused" }
const event = (offset: number, index: number, data: Partial<RoundEvent>): RoundEvent => ({
  kind: "share", block: (first + BigInt(offset)).toString(), index, time: now - 86400, ...data,
})
const checkpoint = async (db: SqlDatabase) => (await db.request<{ value: Chronology }[]>("alerts_state?key=eq.aegis"))[0]!.value
async function lease(db: SqlDatabase) {
  const holder = crypto.randomUUID()
  assert.equal(await db.rpc("lock_run", { holder }), true)
  return holder
}

test("over 10,000 unmatched ceremonies persist across restarts and an old winning share survives late attestation", async () => {
  const db = new SqlDatabase(); await db.setup()
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
      await db.rpc("lock_run", { holder, release: true })
      holder = await lease(db)
      state = await checkpoint(db)
    }
    assert.equal((await db.pg.query<{ count: number }>("select count(*)::int as count from alerts_ceremonies")).rows[0]!.count, 11_000)
    state = await persistChronologyBatch(db, holder, state, [
      event(100_000, 0, { kind: "completed", sid: "sid-0", root: "winner" }),
      event(100_000, 1, { kind: "attested", sid: "sid-0" }),
    ], first + 100_000n, "late", now)
    assert.deepEqual(state.rounds[0]!.present, [signer])
    assert.equal(memberCondition(state, staker, now)[0]!.misses, 0)
    assert.equal(memberCondition(state, staker, now)[0]!.participation, 100)
    assert.deepEqual((await db.pg.query<{ ceremony: unknown }>("select ceremony from alerts_ceremonies where sid='sid-0'")).rows[0]!.ceremony, { shares: {}, counted: true })
    assert.deepEqual(await checkpoint(db), state)
  } finally { await db.pg.close() }
})

test("archive recovery preserves completion blocking, chronological order and attestation membership snapshots", async () => {
  const db = new SqlDatabase(); await db.setup()
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
    assert.deepEqual(await db.rpc("load_ceremonies", { holder, expected_revision: state.revision, sids: ["later"] }),
      { later: { shares: {}, counted: true } })
    state = await persistChronologyBatch(db, holder, state, [], first + 2000n, "pruned", now)
    assert.equal(state.counted.later, undefined)
    state = await persistChronologyBatch(db, holder, await checkpoint(db), [
      event(2001, 0, { kind: "attested", sid: "later" }),
    ], first + 2001n, "repeated", now)
    assert.deepEqual(state.pending, {})
    assert.deepEqual(state.rounds.map(r => r.sid), ["early", "later"])
  } finally { await db.pg.close() }
})

test("one completion archives every newly released round beyond the input-event batch limit", async () => {
  const db = new SqlDatabase(); await db.setup()
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
    assert.equal((await db.pg.query<{ count: number }>("select count(*)::int as count from alerts_ceremonies where ceremony ? 'counted'")).rows[0]!.count, 1201)
    assert.deepEqual(await checkpoint(db), state)
  } finally { await db.pg.close() }
})

test("migration atomically moves legacy JSON entries and retains blocked rounds and snapshots", async () => {
  const db = new SqlDatabase(); await db.setup(false)
  try {
    const legacy: Chronology = { ...initialChronology(),
      pending: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`legacy-${i}`, { shares: { winner: [signer] }, root: "winner" }])) }
    delete legacy.archiveVersion
    delete legacy.revision
    legacy.counted["old-counted"] = legacy.cursor
    legacy.pending.blocked = { shares: {}, at: { block: first.toString(), index: 0, time: now, members: [signer] } }
    legacy.members[signer] = { staker, misses: 0, streakStart: null }
    await db.rpc("save_state", { state_key: "aegis", state_value: legacy })
    const oldHolder = await lease(db)
    await db.pg.exec("reset role")
    await db.pg.exec(await readFile(new URL("../migrations/002_ceremony_archive.sql", import.meta.url), "utf8"))
    await db.pg.exec("set role service_role")
    const migrated = await checkpoint(db)
    assert.deepEqual(migrated.pending, { blocked: legacy.pending.blocked })
    assert.equal(migrated.cursor, legacy.cursor)
    assert.equal(migrated.revision, 1)
    assert.equal((await db.pg.query<{ count: number }>("select count(*)::int as count from alerts_ceremonies")).rows[0]!.count, 10_001)
    await assert.rejects(db.rpc("load_ceremonies", { holder: oldHolder, expected_revision: 1, sids: ["legacy-0"] }), /lease/)
    await assert.rejects(db.rpc("save_state", { state_key: "aegis", state_value: legacy }), /atomic/)
    const holder = await lease(db)
    assert.deepEqual(await db.rpc("load_ceremonies", { holder, expected_revision: 1, sids: ["old-counted"] }), { "old-counted": { shares: {}, counted: true } })
    const next = await persistChronologyBatch(db, holder, migrated, [
      event(0, 1, { kind: "completed", sid: "blocked", root: "winner" }),
      event(0, 2, { kind: "attested", sid: "legacy-0" }),
    ], first, "migrated", now)
    assert.deepEqual(next.rounds.map(r => r.present), [[], [signer]])
    assert.equal(next.members[signer]!.misses, 0)
  } finally { await db.pg.close() }
})

test("archive write failure rolls back deletions and checkpoint, and the poller sends no false attendance alerts", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer, staker }),
    ], first, "before", now)
    await db.rpc("lock_run", { holder, release: true })
    await db.pg.exec("reset role")
    await db.pg.exec(`create function reject_archive_write() returns trigger language plpgsql as $$
      begin raise exception 'archive unavailable'; end $$;
      create trigger reject_archive before insert or update on alerts_ceremonies for each row execute function reject_archive_write();`)
    await db.pg.exec("set role service_role")
    await db.rpc("subscribe", { owner_wallet: staker, signature: "test", link: "test", settings: {
      triggers: ["missed", "participation"], missed: 1, participation: 100,
      channel: { kind: "push", endpoint: "https://fcm.googleapis.com/test", keys: {} },
    } })
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
    assert.equal((await db.pg.query("select * from alerts_ceremonies where sid='old'")).rows.length, 1)
    assert.equal((await db.pg.query("select * from alerts_ceremonies where sid='new'")).rows.length, 0)
    assert.equal((await db.request<{ ok: boolean }[]>("alerts_runs"))[0]!.ok, false)
  } finally { await db.pg.close() }
})

test("incomplete recovery and stale owners or revisions cannot advance the checkpoint", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer }),
    ], first, "before", now)
    const events = [event(1, 0, { kind: "attested", sid: "old" })]
    const original = db.rpc.bind(db)
    db.rpc = async <T>(name: string, body: unknown): Promise<T> => name === "load_ceremonies" ? {} as T : original<T>(name, body)
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /Incomplete ceremony recovery/)
    db.rpc = original
    await assert.rejects(persistChronologyBatch(db, holder, initialChronology(), events, first + 1n, "after", now), /revision/)
    await db.pg.query("update alerts_lock set until_at=now()-interval '1 second'")
    const successor = await lease(db)
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /lease/)
    assert.deepEqual(await checkpoint(db), before)
    await assert.rejects(db.rpc("save_chronology", { holder, expected_revision: 1, state_value: { ...before, revision: 2 },
      archive_writes: {}, archive_deletes: ["old"] }), /lease/)
    // Two writers with the same lease and snapshot still cannot commit twice.
    const outcomes = await Promise.allSettled([1, 2].map(() => persistChronologyBatch(db, successor, before, events, first + 1n, "after", now)))
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1)
    assert.equal((await checkpoint(db)).revision, 2)
    await db.pg.exec("set role anon")
    await assert.rejects(db.pg.query("select * from alerts_ceremonies"), /permission denied/)
    await assert.rejects(db.rpc("load_ceremonies", { holder: successor, expected_revision: 2, sids: [] }), /permission denied/)
    await assert.rejects(db.rpc("save_chronology", { holder: successor, expected_revision: 2, state_value: {}, archive_writes: {}, archive_deletes: [] }), /permission denied/)
  } finally { await db.pg.close() }
})

test("checkpoint failure and lease expiry during commit roll back every archive mutation", async () => {
  const db = new SqlDatabase(); await db.setup()
  try {
    const holder = await lease(db)
    const before = await persistChronologyBatch(db, holder, initialChronology(), [
      event(0, 0, { sid: "old", root: "winner", participant: signer }),
    ], first, "before", now)
    const events = [event(1, 0, { kind: "attested", sid: "old" }),
      event(1, 1, { sid: "new", root: "winner", participant: signer })]
    await db.pg.exec("reset role")
    await db.pg.exec(`create function reject_checkpoint() returns trigger language plpgsql as $$
      begin raise exception 'checkpoint unavailable'; end $$;
      create trigger reject_checkpoint before update on alerts_state for each row execute function reject_checkpoint();`)
    await db.pg.exec("set role service_role")
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /checkpoint unavailable/)
    assert.deepEqual(await checkpoint(db), before)
    assert.deepEqual((await db.pg.query<{ sid: string }>("select sid from alerts_ceremonies")).rows, [{ sid: "old" }])
    await db.pg.exec("reset role")
    await db.pg.exec(`drop trigger reject_checkpoint on alerts_state;
      create function expire_chronology_lease() returns trigger language plpgsql as $$
      begin update alerts_lock set until_at=clock_timestamp()-interval '1 second'; return new; end $$;
      create trigger expire_lease before insert on alerts_ceremonies for each row execute function expire_chronology_lease();`)
    await db.pg.exec("set role service_role")
    await assert.rejects(persistChronologyBatch(db, holder, before, events, first + 1n, "after", now), /lease lost/)
    assert.deepEqual(await checkpoint(db), before)
    assert.deepEqual((await db.pg.query<{ sid: string }>("select sid from alerts_ceremonies")).rows, [{ sid: "old" }])
  } finally { await db.pg.close() }
})

test("oversized archived ceremonies fail migration without losing legacy JSON", async () => {
  const db = new SqlDatabase(); await db.setup(false)
  try {
    const before = initialChronology()
    delete before.archiveVersion
    delete before.revision
    before.pending.large = { shares: { winner: Array.from({ length: 2000 }, () => signer) } }
    await db.rpc("save_state", { state_key: "aegis", state_value: before })
    await db.pg.exec("reset role")
    await assert.rejects(db.pg.exec(await readFile(new URL("../migrations/002_ceremony_archive.sql", import.meta.url), "utf8")), /check constraint/)
    await db.pg.exec("rollback; set role service_role")
    assert.deepEqual(await checkpoint(db), before)
    assert.equal((await db.pg.query<{ name: string | null }>("select to_regclass('public.alerts_ceremonies')::text as name")).rows[0]!.name, null)
  } finally { await db.pg.close() }
})

test("counted SID tombstones survive pruning and restart without blocking later or delayed first attestations", async () => {
  const db = new SqlDatabase(); await db.setup()
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
    const rows = await db.pg.query<{ ceremony: { counted: boolean } }>("select ceremony from alerts_ceremonies")
    assert.equal(rows.rows.length, 3)
    assert.ok(rows.rows.every(row => row.ceremony.counted))
  } finally { await db.pg.close() }
})
