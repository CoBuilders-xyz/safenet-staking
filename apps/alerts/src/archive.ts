import { foldArchivedBatch, type Ceremony, type Chronology, type RoundEvent } from "./chronology.js"
import type { Database } from "./db.js"

// Match migration 002. Bound transfers as well as ceremony counts.
export const CHRONOLOGY_BATCH_EVENTS = 1000
const MAX_TRANSFER_BYTES = 8 * 1024 * 1024
const MAX_CEREMONY_BYTES = 64 * 1024
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

export async function persistChronologyBatch(db: Database, holder: string, previous: Chronology,
  events: RoundEvent[], through: bigint, hash: string, now: number): Promise<Chronology> {
  if (previous.archiveVersion !== 1) throw new Error("Chronology archive migration required")
  if (events.length > CHRONOLOGY_BATCH_EVENTS) throw new Error("Chronology event batch exceeds capacity")
  const sids = [...new Set(events.flatMap(event => event.sid ? [event.sid] : []))]
  const recovered = await db.rpc<Record<string, Ceremony | null>>("load_ceremonies", {
    holder, expected_revision: previous.revision ?? 0, sids,
  })
  // A missing response entry is different from an explicit SQL NULL for a new SID.
  if (!recovered || Object.keys(recovered).length !== sids.length || sids.some(sid => !Object.hasOwn(recovered, sid))) {
    throw new Error("Incomplete ceremony recovery")
  }
  if (bytes(recovered) > MAX_TRANSFER_BYTES) throw new Error("Ceremony recovery exceeds capacity")
  const hydrated = { ...previous, pending: { ...previous.pending } }
  for (const [sid, ceremony] of Object.entries(recovered)) {
    if (ceremony === null) continue
    if (!ceremony.shares || typeof ceremony.shares !== "object" || Array.isArray(ceremony.shares) || ceremony.at
      || Object.values(ceremony.shares).some(shares => !Array.isArray(shares) || shares.some(who => typeof who !== "string"))
      || (ceremony.root !== undefined && typeof ceremony.root !== "string") || bytes(ceremony) > MAX_CEREMONY_BYTES
      || hydrated.pending[sid] || previous.counted[sid]) throw new Error("Invalid ceremony recovery")
    hydrated.pending[sid] = ceremony
  }
  const { state, writes } = foldArchivedBatch(hydrated, events, through, hash, now)
  state.revision = (previous.revision ?? 0) + 1
  if (bytes(state) > MAX_TRANSFER_BYTES || bytes(writes) > MAX_TRANSFER_BYTES
    || Object.values(writes).some(ceremony => bytes(ceremony) > MAX_CEREMONY_BYTES)) throw new Error("Chronology storage capacity reached")
  // Delete recovered rows when they move into the ordered pending queue or become counted.
  const deletes = sids.filter(sid => recovered[sid] !== null && !writes[sid])
  const saved = await db.rpc<number>("save_chronology", {
    holder, expected_revision: previous.revision ?? 0, state_value: state, archive_writes: writes, archive_deletes: deletes,
  })
  if (saved !== state.revision) throw new Error("Chronology commit not confirmed")
  return state
}
