/**
 * The query schema graph-node serves, derived from a subgraph's own schema.graphql.
 *
 * A subgraph's schema.graphql declares entities. It has no Query type, no filters and no
 * `_meta`: graph-node adds those when it serves the subgraph. Codegen needs the served schema,
 * and introspecting a running node would make codegen depend on a deployment. So this derives
 * it from the file, following graph-node's rules (graph/src/schema/api.rs), which keeps
 * schema.graphql the one source.
 *
 * It emits a SUBSET of what graph-node serves: the scalars, `_meta`, both query fields per entity
 * and the common filter operators. A document that validates against the subset validates against
 * the real schema; a document using an operator left out here fails codegen, which is the safe
 * direction. `pnpm codegen:live-check` validates the documents against a running node.
 */
import { readFileSync } from "node:fs"
import {
  Kind,
  parse,
  type FieldDefinitionNode,
  type ObjectTypeDefinitionNode,
  type TypeNode,
} from "graphql"

const BUILT_IN = `
scalar BigDecimal
scalar BigInt
scalar Bytes
scalar Int8
scalar Timestamp

enum OrderDirection { asc desc }
enum _SubgraphErrorPolicy_ { allow deny }

input Block_height { hash: Bytes number: Int number_gte: Int }
input BlockChangedFilter { number_gte: Int! }

type _Block_ { hash: Bytes number: Int! timestamp: Int parentHash: Bytes }
type _Meta_ { block: _Block_! deployment: String! hasIndexingErrors: Boolean! }
`

const SCALARS = new Set(["ID", "String", "Int", "Boolean", "BigInt", "BigDecimal", "Bytes", "Int8", "Timestamp"])
const ORDERED = new Set(["ID", "String", "Int", "BigInt", "BigDecimal", "Bytes", "Int8", "Timestamp"])

interface Shape {
  name: string
  list: boolean
}

function shape(type: TypeNode): Shape {
  if (type.kind === Kind.NON_NULL_TYPE) return shape(type.type)
  if (type.kind === Kind.LIST_TYPE) return { ...shape(type.type), list: true }
  return { name: type.name.value, list: false }
}

/** graph-node's printer drops the directives; the type text is otherwise kept as written. */
function typeText(type: TypeNode): string {
  if (type.kind === Kind.NON_NULL_TYPE) return `${typeText(type.type)}!`
  if (type.kind === Kind.LIST_TYPE) return `[${typeText(type.type)}]`
  return type.name.value
}

const isDerived = (f: FieldDefinitionNode) => (f.directives ?? []).some((d) => d.name.value === "derivedFrom")

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * graph-node pluralises with the `inflector` crate and appends `_collection` when the plural
 * equals the singular. This covers the rules our entity names reach; the live check catches a
 * name it gets wrong.
 */
export function pluralField(entity: string): string {
  const single = lowerFirst(entity)
  let plural: string
  if (/[^aeiou]y$/.test(single)) plural = `${single.slice(0, -1)}ies`
  // Consensus is served as `consensuses`, checked against graph-node v0.40.2.
  else if (/(s|x|ch|sh)$/.test(single)) plural = `${single}es`
  else plural = `${single}s`
  return plural === single ? `${single}_collection` : plural
}

function filterFields(entity: ObjectTypeDefinitionNode, entities: Set<string>): string[] {
  const out: string[] = []
  for (const f of entity.fields ?? []) {
    if (isDerived(f)) continue
    const { name, list } = shape(f.type)
    const field = f.name.value
    if (list) {
      const inner = entities.has(name) ? "String" : name
      out.push(`${field}: [${inner}!]`, `${field}_not: [${inner}!]`, `${field}_contains: [${inner}!]`, `${field}_not_contains: [${inner}!]`)
      continue
    }
    if (entities.has(name)) {
      out.push(
        `${field}: String`, `${field}_not: String`, `${field}_in: [String!]`, `${field}_not_in: [String!]`,
        `${field}_: ${name}_filter`,
      )
      continue
    }
    if (!SCALARS.has(name)) continue
    out.push(`${field}: ${name}`, `${field}_not: ${name}`, `${field}_in: [${name}!]`, `${field}_not_in: [${name}!]`)
    if (ORDERED.has(name)) {
      out.push(`${field}_gt: ${name}`, `${field}_lt: ${name}`, `${field}_gte: ${name}`, `${field}_lte: ${name}`)
    }
  }
  out.push("_change_block: BlockChangedFilter", `and: [${entity.name.value}_filter]`, `or: [${entity.name.value}_filter]`)
  return out
}

const LIST_ARGS = (entity: string) =>
  `skip: Int = 0, first: Int = 100, orderBy: ${entity}_orderBy, orderDirection: OrderDirection, where: ${entity}_filter`

/** The served schema, as SDL, for the subgraph schema at `path`. */
export function subgraphApiSchema(path: string): string {
  const doc = parse(readFileSync(path, "utf8"))
  const entities = doc.definitions.filter(
    (d): d is ObjectTypeDefinitionNode =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION && (d.directives ?? []).some((x) => x.name.value === "entity"),
  )
  const names = new Set(entities.map((e) => e.name.value))
  const parts = [BUILT_IN]
  const query: string[] = ["_meta(block: Block_height): _Meta_"]

  for (const e of entities) {
    const name = e.name.value
    const fields = (e.fields ?? []).map((f) => {
      const { name: target, list } = shape(f.type)
      const args = list && names.has(target) ? `(${LIST_ARGS(target)})` : ""
      return `  ${f.name.value}${args}: ${typeText(f.type)}`
    })
    parts.push(`type ${name} {\n${fields.join("\n")}\n}`)
    const orderable = (e.fields ?? []).filter((f) => !isDerived(f)).map((f) => f.name.value)
    parts.push(`enum ${name}_orderBy { ${orderable.join(" ")} }`)
    parts.push(`input ${name}_filter {\n  ${filterFields(e, names).join("\n  ")}\n}`)

    const common = "block: Block_height, subgraphError: _SubgraphErrorPolicy_! = deny"
    query.push(`${lowerFirst(name)}(id: ID!, ${common}): ${name}`)
    query.push(`${pluralField(name)}(${LIST_ARGS(name)}, ${common}): [${name}!]!`)
  }

  parts.push(`type Query {\n  ${query.join("\n  ")}\n}`)
  return parts.join("\n\n") + "\n"
}
