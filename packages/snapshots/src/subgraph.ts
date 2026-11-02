/**
 * Reading a whole entity from a subgraph at one block, page by page.
 *
 * Every query names the block by its hash, so all the rows of a snapshot come from one view of
 * each subgraph, the view at the block the chain figures were read at. A hash the subgraph's
 * chain does not hold is an error, not the nearest block: a subgraph on another fork than the
 * RPC fails the day. graph-node caps `first` at 1000, so rows are read in pages of that size,
 * ordered by id.
 */
import { SnapshotError } from "./errors.js"

/** One GraphQL query against one subgraph, answering its `data`. */
export type Query = (query: string) => Promise<unknown>

/** A block, by number for the messages and by hash for the queries. */
export interface BlockRef {
  readonly number: bigint
  readonly hash: string
}

const at = (block: BlockRef) => `block: { hash: ${JSON.stringify(block.hash)} }`

const PAGE = 1000

/** Every row of `entity`, the plural query field, with `fields`, at `block`. */
export async function allRows<T extends { id: string }>(
  query: Query,
  entity: string,
  fields: string,
  block: BlockRef,
): Promise<T[]> {
  const rows: T[] = []
  for (let after = ""; ;) {
    const data = (await query(`{
      ${entity}(first: ${PAGE}, orderBy: id, orderDirection: asc, ${at(block)}, where: { id_gt: ${JSON.stringify(after)} }) {
        id ${fields}
      }
    }`)) as Record<string, T[] | undefined>
    const got = data[entity]
    if (!Array.isArray(got)) throw new SnapshotError(`the subgraph answered no ${entity} at block ${block.number}`)
    rows.push(...got)
    if (got.length < PAGE) return rows
    after = got[got.length - 1]!.id
  }
}

/** One row by id at `block`. A missing row is a figure that cannot be read. */
export async function oneRow<T>(query: Query, entity: string, id: string, fields: string, block: BlockRef): Promise<T> {
  const data = (await query(`{ ${entity}(id: ${JSON.stringify(id)}, ${at(block)}) { ${fields} } }`)) as Record<
    string,
    T | null | undefined
  >
  const row = data[entity]
  if (!row) throw new SnapshotError(`the subgraph has no ${entity} "${id}" at block ${block.number}`)
  return row
}

export interface SubgraphMeta {
  readonly block: { readonly number: bigint; readonly hash: string; readonly timestamp: bigint }
  readonly deployment: string
  readonly hasIndexingErrors: boolean
}

/**
 * `_meta`, at the head the deployment has indexed, or at the block with `hash`. graph-node
 * answers a block's hash and timestamp only when it is named by hash, not by number.
 */
export async function meta(query: Query, hash?: string): Promise<SubgraphMeta> {
  const where = hash === undefined ? "" : `(block: { hash: ${JSON.stringify(hash)} })`
  const data = (await query(`{ _meta${where} { block { number hash timestamp } deployment hasIndexingErrors } }`)) as {
    _meta?: { block?: { number?: number; hash?: string | null; timestamp?: number | null }; deployment?: string; hasIndexingErrors?: boolean }
  }
  const m = data._meta
  if (typeof m?.block?.number !== "number" || typeof m.block.hash !== "string" || typeof m.block.timestamp !== "number" ||
    typeof m.deployment !== "string" || typeof m.hasIndexingErrors !== "boolean") {
    throw new SnapshotError("the subgraph's _meta has no block number, hash, timestamp or deployment")
  }
  return {
    block: { number: BigInt(m.block.number), hash: m.block.hash, timestamp: BigInt(m.block.timestamp) },
    deployment: m.deployment,
    hasIndexingErrors: m.hasIndexingErrors,
  }
}

/**
 * The names of the fields an entity type has, read by introspection. A deployment can be older
 * or newer than the schema in this repository. Older Mainnet overrides can lack first-seen
 * fields, and older Gnosis deployments can lack `programme`. Each read asks only for fields
 * the deployment has.
 */
export async function fieldsOf(query: Query, type: string): Promise<Set<string>> {
  const data = (await query(`{ __type(name: ${JSON.stringify(type)}) { fields { name } } }`)) as {
    __type?: { fields?: { name: string }[] | null } | null
  }
  const fields = data.__type?.fields
  if (!fields) throw new SnapshotError(`the subgraph's schema has no type ${type}`)
  return new Set(fields.map((f) => f.name))
}

/**
 * The fields of `wanted` the type has, as a selection, and the ones it lacks. An entry is a field
 * name, or a name and a sub-selection such as `validator { id }`.
 */
export async function selectFields(
  query: Query,
  type: string,
  wanted: readonly string[],
): Promise<{ selection: string; absent: string[] }> {
  const has = await fieldsOf(query, type)
  const name = (entry: string) => entry.split(/[\s{]/)[0]!
  return {
    selection: wanted.filter((f) => has.has(name(f))).join(" "),
    absent: wanted.filter((f) => !has.has(name(f))).map(name),
  }
}
