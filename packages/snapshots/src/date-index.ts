/**
 * The index of snapshots by date: `index.json` on the `snapshots` branch, and pinned to IPFS
 * after every update.
 *
 * Each version names the CID of the version before it, so the pinned versions form a chain any
 * reader can walk back without the branch. A day already in the index is never replaced: a
 * snapshot is immutable, and a second run on the same day publishes nothing. The preview index a
 * pull request writes is the exception, so each push to the pull request proves the whole path.
 */
import { SnapshotError } from "./errors.js"

export const INDEX_SCHEMA = "safenet-snapshots-index/1"

export interface IndexEntry {
  readonly cid: string
  /** The snapshot's own schema, from its manifest. */
  readonly schema: string
  readonly mainnetBlock: string
  readonly gnosisBlock: string
  /** The Mainnet block's time, ISO 8601. */
  readonly blockTime: string
  /** The repository commit that built it. */
  readonly commit: string | null
}

export interface SnapshotIndex {
  readonly schema: typeof INDEX_SCHEMA
  /** The CID of the index this one updates. Null for the first. */
  readonly previous: string | null
  /** By UTC day, YYYY-MM-DD, oldest first. */
  readonly days: Readonly<Record<string, IndexEntry>>
}

export const emptyIndex = (): SnapshotIndex => ({ schema: INDEX_SCHEMA, previous: null, days: {} })

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CID = /^b[a-z2-7]{20,}$/

/** An index read back from the branch, checked before it is extended. */
export function parseIndex(text: string): SnapshotIndex {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new SnapshotError("index.json is not valid JSON")
  }
  const d = data as Partial<SnapshotIndex> | null
  if (d?.schema !== INDEX_SCHEMA) throw new SnapshotError(`index.json has schema ${JSON.stringify(d?.schema)}, not ${INDEX_SCHEMA}`)
  if (d.previous !== null && (typeof d.previous !== "string" || !CID.test(d.previous))) {
    throw new SnapshotError("index.json's previous is neither null nor a CID")
  }
  if (typeof d.days !== "object" || d.days === null) throw new SnapshotError("index.json has no days")
  for (const [day, entry] of Object.entries(d.days)) {
    if (!DAY.test(day)) throw new SnapshotError(`index.json has a day that is not YYYY-MM-DD: ${day}`)
    if (typeof entry?.cid !== "string" || !CID.test(entry.cid)) throw new SnapshotError(`index.json's ${day} has no CID`)
  }
  return d as SnapshotIndex
}

export type Update =
  | { readonly kind: "added"; readonly index: SnapshotIndex }
  | { readonly kind: "replaced"; readonly index: SnapshotIndex; readonly was: string }
  | { readonly kind: "already published"; readonly cid: string }

/**
 * The index with `day` added. `previousCid` is the CID the current index was pinned under.
 * An existing day stays as it is unless `replace` is set, for the preview index only.
 */
export function addDay(
  current: SnapshotIndex,
  previousCid: string | null,
  day: string,
  entry: IndexEntry,
  options: { replace: boolean },
): Update {
  if (!DAY.test(day)) throw new SnapshotError(`not a UTC day: ${day}`)
  if (!CID.test(entry.cid)) throw new SnapshotError(`not a CIDv1: ${entry.cid}`)
  const existing = current.days[day]
  if (existing && !options.replace) return { kind: "already published", cid: existing.cid }
  const days = Object.fromEntries(
    Object.entries({ ...current.days, [day]: entry }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  const index: SnapshotIndex = { schema: INDEX_SCHEMA, previous: previousCid, days }
  return existing ? { kind: "replaced", index, was: existing.cid } : { kind: "added", index }
}
