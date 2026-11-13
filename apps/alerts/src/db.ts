import type { Ceremony, Chronology } from "./chronology.js"
import type { Subscription, Trigger, Channel } from "./types.js"

/** D1 limits a string, a BLOB and a row to 2 MB. Stay well below it for one bound value or one stored part. */
const PART_BYTES = 1_000_000
/** Transfer bounds of the chronology archive. archive.ts holds the same values. */
const MAX_TRANSFER_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_WRITES = 11_000
const MAX_ARCHIVE_IDS = 1000
const MAX_PENDING = 10_000

const LEASE = 16 * 60_000
const SESSION = 30 * 60_000
/**
 * The interface asks for Start within ten minutes. The Worker reads /start on its next Cron run,
 * up to five minutes later, so the code stays valid for both.
 */
export const LINK_START_WINDOW = 10 * 60_000
const LINK = LINK_START_WINDOW + 5 * 60_000
const RECEIPT = 24 * 60 * 60_000
const DELIVERY_LEASE = 2 * 60_000
const iso = (ms: number) => new Date(ms).toISOString()
/** SQLite's current time, in the same format as Date.toISOString. */
const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const bytes = (value: string) => new TextEncoder().encode(value).byteLength
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** JSON in pure ASCII, so that cutting it at any index never splits a character. */
function ascii(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
}
function parts(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += PART_BYTES) out.push(text.slice(i, i + PART_BYTES))
  return out.length ? out : [""]
}
/** Splits an object into JSON objects of at most PART_BYTES each. One entry never exceeds 64 KiB. */
function objectChunks(entries: [string, unknown][]): string[] {
  const chunks: string[] = []
  let current: string[] = [], size = 2
  for (const [key, value] of entries) {
    const item = `${ascii(key)}:${ascii(value)}`
    if (current.length && size + item.length + 1 > PART_BYTES) { chunks.push(`{${current.join(",")}}`); current = []; size = 2 }
    current.push(item); size += item.length + 1
  }
  if (current.length) chunks.push(`{${current.join(",")}}`)
  return chunks
}

/** Named guard constraints in migration 0002, and the message each failure carries. */
const guards: Record<string, string> = {
  chronology_lease_lost: "chronology lease lost",
  chronology_revision_changed: "chronology revision changed",
  invalid_chronology_batch: "invalid chronology batch",
  alerts_ceremony_shape: "invalid chronology batch",
}
/** Never propagate a driver message unmapped: it can name stored values. */
async function guarded<T>(operation: Promise<T>): Promise<T> {
  try { return await operation } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const guard = Object.keys(guards).find(name => message.includes(name))
    throw new Error(guard ? guards[guard] : "Database operation failed")
  }
}

interface SubscriptionRow {
  id: string; wallet: string; triggers: string; participation: number; missed: number; channel: string
  telegram_chat: string | null; status: Subscription["status"]; last_delivery: string | null
}
const subscription = (row: SubscriptionRow): Subscription => ({
  id: row.id, wallet: row.wallet, triggers: JSON.parse(row.triggers) as Trigger[], participation: row.participation,
  missed: row.missed, channel: JSON.parse(row.channel) as Channel, telegram_chat: row.telegram_chat,
  status: row.status, last_delivery: row.last_delivery,
})
export interface SubscriptionSettings { triggers: Trigger[]; participation: number; missed: number; channel: unknown }
export interface PollRun { started_at: string; completed_at: string | null; ok: boolean }

/**
 * Every query of the alerts Worker. Each operation that changes more than one row runs as one D1
 * batch, which D1 executes as a transaction: a failed statement rolls back the whole batch.
 */
export class Database {
  constructor(protected readonly d1: D1Database) {}
  private sql(query: string, ...values: unknown[]) { return this.d1.prepare(query).bind(...values) }
  private batch(statements: D1PreparedStatement[]) { return guarded(this.d1.batch(statements)) }
  private all<T>(query: string, ...values: unknown[]) { return guarded(this.sql(query, ...values).all<T>()).then(result => result.results) }
  private run(query: string, ...values: unknown[]) { return guarded(this.sql(query, ...values).run()).then(result => result.meta.changes) }

  /** Bounded challenge storage, including requests with forged Origin headers. Null when full. */
  async issueChallenge(wallet: string, message: string, expiresAt: string): Promise<string | null> {
    const now = iso(Date.now())
    const [, inserted] = await this.batch([
      this.sql("delete from alerts_challenges where expires_at <= ?", now),
      this.sql(`insert into alerts_challenges(id, wallet, message, expires_at) select ?1, ?2, ?3, ?4
        where (select count(*) from alerts_challenges where wallet = ?2 and expires_at > ?5) < 10
          and (select count(*) from alerts_challenges where expires_at > ?5) < 1000 returning id`,
      crypto.randomUUID(), wallet, message, expiresAt, now),
    ])
    return (inserted!.results[0] as { id: string } | undefined)?.id ?? null
  }
  async challenge(id: string) {
    const [row] = await this.all<{ wallet: string; message: string; expires_at: string; used: number }>(
      "select wallet, message, expires_at, used from alerts_challenges where id = ?", id)
    return row ? { ...row, used: row.used === 1 } : undefined
  }
  /** Consumes the challenge once and opens a 30-minute session. False when used or expired. */
  async authenticate(challenge: string, tokenHash: string, signatureHash: string): Promise<boolean> {
    const now = Date.now()
    const [, session] = await this.batch([
      this.sql("delete from alerts_sessions where expires_at <= ?", iso(now)),
      this.sql(`insert into alerts_sessions(token_hash, wallet, signature_hash, expires_at)
        select ?, wallet, ?, ? from alerts_challenges where id = ? and used = 0 and expires_at > ?`,
      tokenHash, signatureHash, iso(now + SESSION), challenge, iso(now)),
      // Consume the challenge exactly when the session above exists.
      this.sql(`update alerts_challenges set used = 1 where id = ? and used = 0
        and exists (select 1 from alerts_sessions where token_hash = ?)`, challenge, tokenHash),
    ])
    return session!.meta.changes === 1
  }
  async session(tokenHash: string) {
    const [row] = await this.all<{ wallet: string; signature_hash: string }>(
      "select wallet, signature_hash from alerts_sessions where token_hash = ? and expires_at > ?", tokenHash, iso(Date.now()))
    return row
  }

  async subscriptions(wallet: string): Promise<Subscription[]> {
    return (await this.all<SubscriptionRow>("select * from alerts_subscriptions where wallet = ? order by created_at, rowid", wallet)).map(subscription)
  }
  /** At most ten subscriptions per wallet, checked in the same statement that inserts. */
  async subscribe(wallet: string, signatureHash: string, settings: SubscriptionSettings, linkHash: string): Promise<Subscription> {
    const now = Date.now()
    const [row] = await this.all<SubscriptionRow>(`insert into alerts_subscriptions(id, wallet, signature_hash, triggers,
      participation, missed, channel, link_hash, link_expires, created_at)
      select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 where (select count(*) from alerts_subscriptions where wallet = ?2) < 10
      returning *`, crypto.randomUUID(), wallet, signatureHash, JSON.stringify(settings.triggers), settings.participation,
    settings.missed, JSON.stringify(settings.channel), linkHash, iso(now + LINK), iso(now))
    if (!row) throw new Error("Subscription limit reached")
    return subscription(row)
  }
  /** Removes the wallet's own subscription only. Its delivery history goes with it. */
  async unsubscribe(id: string, wallet: string) {
    await this.run("delete from alerts_subscriptions where id = ? and wallet = ?", id, wallet)
  }
  /** Subscriptions the poller evaluates, in id order after `after`. */
  async activeSubscriptions(after: string, limit: number): Promise<Subscription[]> {
    return (await this.all<SubscriptionRow>("select * from alerts_subscriptions where status != 'expired' and id > ? order by id limit ?",
      after, limit)).map(subscription)
  }
  async linkTelegram(linkHash: string, chat: string): Promise<boolean> {
    return await this.run(`update alerts_subscriptions set telegram_chat = ?, link_hash = null, link_expires = null
      where link_hash = ? and link_expires > ? and json_extract(channel, '$.kind') = 'telegram'`, chat, linkHash, iso(Date.now())) > 0
  }

  /** Claims an event for delivery. A failed or abandoned claim can be taken again once its lease ends. */
  async reserve(subscriptionId: string, eventKey: string, ackHash: string): Promise<boolean> {
    const now = Date.now()
    return await this.run(`insert into alerts_deliveries(subscription, event_key, ack_hash, ack_expires, state, lease_until, attempts, updated_at)
      values (?1, ?2, ?3, ?4, 'sending', ?5, 1, ?6)
      on conflict(subscription, event_key) do update set state = 'sending', lease_until = excluded.lease_until,
        ack_hash = excluded.ack_hash, ack_expires = excluded.ack_expires, attempts = alerts_deliveries.attempts + 1,
        updated_at = excluded.updated_at
      where alerts_deliveries.state in ('failed', 'sending') and alerts_deliveries.lease_until < ?6`,
    subscriptionId, eventKey, ackHash, iso(now + RECEIPT), iso(now + DELIVERY_LEASE), iso(now)) > 0
  }
  /** Finishes only our own attempt: a reclaimed lease has another receipt capability. Returns the rows changed. */
  async finishDelivery(subscriptionId: string, eventKey: string, ackHash: string, accepted: boolean): Promise<number> {
    return this.run(`update alerts_deliveries set state = ?, updated_at = ?
      where subscription = ? and event_key = ? and state = 'sending' and ack_hash = ?`,
    accepted ? "accepted" : "failed", iso(Date.now()), subscriptionId, eventKey, ackHash)
  }
  async expireSubscription(id: string) {
    await this.run("update alerts_subscriptions set status = 'expired' where id = ?", id)
  }
  /**
   * Records receipt once. With `chat`, only the subscription's linked Telegram chat can confirm it.
   * A receipt for an older delivery never reactivates an expired subscription.
   */
  async acknowledge(ackHash: string, chat?: string): Promise<boolean> {
    const now = iso(Date.now())
    const match = `ack_hash = ?1 and ack_expires > ?2 and state in ('sending', 'accepted')
      and (?3 is null or subscription in (select id from alerts_subscriptions where telegram_chat = ?3))`
    const [, received] = await this.batch([
      this.sql(`update alerts_subscriptions set status = 'verified', last_delivery = ?2
        where status != 'expired' and id in (select subscription from alerts_deliveries where ${match})`, ackHash, now, chat ?? null),
      this.sql(`update alerts_deliveries set state = 'received', updated_at = ?2 where ${match}`, ackHash, now, chat ?? null),
    ])
    return received!.meta.changes > 0
  }

  async state<T>(key: string): Promise<T | undefined> {
    const rows = await this.all<{ value: string }>("select value from alerts_state where key = ? order by part", key)
    return rows.length ? JSON.parse(rows.map(row => row.value).join("")) as T : undefined
  }
  private writeState(key: string, value: unknown) {
    return [this.sql("delete from alerts_state where key = ?", key),
      ...parts(ascii(value)).map((part, index) => this.sql("insert into alerts_state(key, part, value) values (?, ?, ?)", key, index, part))]
  }
  async saveState(key: string, value: unknown) {
    // The Aegis checkpoint changes only together with its archive, in saveChronology.
    if (key === "aegis") throw new Error("use atomic chronology commit")
    await this.batch(this.writeState(key, value))
  }

  /**
   * The poll lease. It outlives the scheduled Worker's 15-minute wall-clock limit, so slow upstream
   * reads inside one subscription cannot let a second poller overlap this invocation.
   */
  async lockRun(holder: string): Promise<boolean> {
    const now = Date.now()
    return await this.run("update alerts_lock set owner = ?, until_at = ? where id = 1 and (until_at is null or until_at < ?)",
      holder, iso(now + LEASE), iso(now)) === 1
  }
  async releaseRun(holder: string): Promise<boolean> {
    return await this.run("update alerts_lock set owner = null, until_at = null where owner = ?", holder) === 1
  }

  async startRun(startedAt: string) { await this.run("insert into alerts_runs(started_at) values (?)", startedAt) }
  async finishRun(startedAt: string, counts: { ok: boolean; evaluated: number; accepted: number; failed: number }) {
    await this.run("update alerts_runs set completed_at = ?, ok = ?, evaluated = ?, accepted = ?, failed = ? where started_at = ?",
      iso(Date.now()), counts.ok ? 1 : 0, counts.evaluated, counts.accepted, counts.failed, startedAt)
  }
  async latestRun(): Promise<PollRun | undefined> {
    const [row] = await this.all<{ started_at: string; completed_at: string | null; ok: number }>(
      "select started_at, completed_at, ok from alerts_runs order by started_at desc limit 1")
    return row && { ...row, ok: row.ok === 1 }
  }
  /** Runs with from <= started_at < until and started_at > after, in order. */
  async runs(from: string, until: string, after: string, limit: number): Promise<PollRun[]> {
    const rows = await this.all<{ started_at: string; completed_at: string | null; ok: number }>(
      `select started_at, completed_at, ok from alerts_runs where started_at >= ? and started_at < ? and started_at > ?
       order by started_at limit ?`, from, until, after, limit)
    return rows.map(row => ({ ...row, ok: row.ok === 1 }))
  }

  async cleanup() {
    const now = iso(Date.now())
    await this.batch([
      this.sql("delete from alerts_challenges where expires_at < ?", now),
      this.sql("delete from alerts_sessions where expires_at < ?", now),
      this.sql("update alerts_subscriptions set link_hash = null, link_expires = null where link_expires < ?", now),
      // Keep event keys while subscriptions exist, so that an unclaimed condition does not resend.
      this.sql("update alerts_deliveries set ack_hash = null, ack_expires = null where ack_expires < ?", now),
      // Thirteen months of aggregate availability evidence; no wallet or endpoint in this table.
      this.sql("delete from alerts_runs where started_at < strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-13 months')", now),
    ])
  }

  /** Fails the batch unless `holder` still holds an unexpired lease, by SQLite's clock at that statement. */
  private leaseGuard(holder: string) {
    return this.sql(`insert into alerts_guard(lease) select 1 where not exists
      (select 1 from alerts_lock where owner = ? and until_at > ${SQL_NOW})`, holder)
  }
  private revisionGuard(expected: number) {
    return this.sql("insert into alerts_guard(revision) select 1 where (select revision from alerts_chronology) != ?", expected)
  }

  /**
   * One explicit entry per requested SID, null for a new ceremony. Null overall when the answer
   * exceeds the 8 MiB transfer bound: the caller retries with fewer blocks. Nothing changes.
   */
  async loadCeremonies(holder: string, expectedRevision: number, sids: string[]): Promise<Record<string, Ceremony | null> | null> {
    if (!Array.isArray(sids) || sids.length > MAX_ARCHIVE_IDS) throw new Error("archive batch limit")
    // Measure the answer in SQL first, and return no payload above the bound: 1,000 ceremonies of
    // 64 KiB would also exceed D1's 50 MB result limit, which fails instead of shrinking the range.
    const size = `select 2 + coalesce(sum(length(cast(s.value as blob)) + coalesce(length(cast(c.ceremony as blob)), 4) + 4), 0) as size
      from json_each(?1) s left join alerts_ceremonies c on c.sid = s.value`
    const [, , measured, found] = await this.batch([
      this.leaseGuard(holder), this.revisionGuard(expectedRevision),
      this.sql(size, JSON.stringify(sids)),
      this.sql(`select s.value as sid, c.ceremony from json_each(?1) s left join alerts_ceremonies c on c.sid = s.value
        where (${size}) <= ?2`, JSON.stringify(sids), MAX_TRANSFER_BYTES),
    ])
    if ((measured!.results[0] as { size: number }).size > MAX_TRANSFER_BYTES) return null
    const result: Record<string, Ceremony | null> = {}
    for (const row of found!.results as { sid: string; ceremony: string | null }[]) {
      result[row.sid] = row.ceremony === null ? null : JSON.parse(row.ceremony) as Ceremony
    }
    return result
  }

  /** Saves archive deletions, archive writes and the checkpoint in one transaction. Returns the new revision. */
  async saveChronology(holder: string, expectedRevision: number, state: Chronology,
    writes: Record<string, Ceremony | { shares: Record<string, never>; counted: true }>, deletes: string[]): Promise<number> {
    const stateJson = ascii(state)
    if (state.revision !== expectedRevision + 1 || state.archiveVersion !== 1 || !isObject(state.pending)
      || bytes(stateJson) > MAX_TRANSFER_BYTES || !isObject(writes) || bytes(ascii(writes)) > MAX_TRANSFER_BYTES
      || !Array.isArray(deletes) || deletes.length > MAX_ARCHIVE_IDS
      // A batch of 1,000 events can release all 10,000 previously blocked attestations.
      // Their compact tombstones must commit atomically with the checkpoint.
      || Object.keys(writes).length > MAX_ARCHIVE_WRITES || Object.keys(state.pending).length > MAX_PENDING
      || Object.values(state.pending).some(ceremony => !isObject(ceremony) || !Object.hasOwn(ceremony, "at"))
      || !/^\d+$/.test(state.cursor)) throw new Error("invalid chronology batch")
    await this.batch([
      this.leaseGuard(holder), this.revisionGuard(expectedRevision),
      this.sql("insert into alerts_guard(batch) select 1 where ? < (select cursor from alerts_chronology)", Number(state.cursor)),
      this.sql("delete from alerts_ceremonies where sid in (select value from json_each(?))", JSON.stringify(deletes)),
      ...objectChunks(Object.entries(writes)).map(chunk => this.sql(`insert into alerts_ceremonies(sid, ceremony)
        select key, value from json_each(?) where true on conflict(sid) do update set ceremony = excluded.ceremony`, chunk)),
      this.sql("delete from alerts_state where key = 'aegis'"),
      ...parts(stateJson).map((part, index) => this.sql("insert into alerts_state(key, part, value) values ('aegis', ?, ?)", index, part)),
      this.sql("update alerts_chronology set revision = ?, cursor = ?", state.revision, Number(state.cursor)),
      // Check expiry again after the writes. Any failure rolls back archive and checkpoint together.
      this.leaseGuard(holder),
    ])
    return expectedRevision + 1
  }
}

export async function digest(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex")
}
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
