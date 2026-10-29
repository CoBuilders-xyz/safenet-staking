import { PGlite } from "@electric-sql/pglite"
import { URL } from "node:url"
import { readFile } from "node:fs/promises"
import { Database } from "../db.js"

const identifier = (s: string) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error("Invalid test SQL identifier")
  return `"${s}"`
}
const parameter = (v: unknown) => v !== null && typeof v === "object" ? JSON.stringify(v) : v
/** Test-only PostgREST facade over real PostgreSQL semantics; no mock of the migration functions. */
export class SqlDatabase extends Database {
  readonly pg = new PGlite()
  constructor() { super({ SUPABASE_URL: "https://unused.test", SUPABASE_SERVICE_KEY: "unused" }) }
  async setup() {
    await this.pg.exec("create role anon; create role authenticated; create role service_role bypassrls;")
    await this.pg.exec(await readFile(new URL("../../migrations/001_alerts.sql", import.meta.url), "utf8"))
    await this.pg.exec("set role service_role")
  }
  override async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const url = new URL(path, "https://unused.test/")
    const data = (body ?? {}) as Record<string, unknown>
    const params: unknown[] = []
    const bind = (value: unknown) => { params.push(parameter(value)); return `$${params.length}` }
    if (url.pathname.startsWith("/rpc/")) {
      const name = url.pathname.slice(5)
      const query = `select * from ${identifier(name)}(${Object.entries(data).map(([k, v]) => `${identifier(k)} => ${bind(k === "state_value" && typeof v === "string" ? JSON.stringify(v) : v)}`).join(",")})`
      const { rows } = await this.pg.query<Record<string, unknown>>(query, params)
      return (["alerts_subscribe", "alerts_issue_challenge"].includes(name) ? rows : rows[0]?.[name]) as T
    }
    const table = identifier(url.pathname.slice(1))
    let query: string
    if (method === "POST") query = `insert into ${table} (${Object.keys(data).map(identifier).join(",")}) values (${Object.values(data).map(bind).join(",")})`
    else if (method === "PATCH") query = `update ${table} set ${Object.entries(data).map(([k, v]) => `${identifier(k)}=${bind(v)}`).join(",")}`
    else if (method === "DELETE") query = `delete from ${table}`
    else query = `select * from ${table}`
    if (method !== "POST") {
      const where: string[] = []
      for (const [key, value] of url.searchParams) {
        if (["limit", "order"].includes(key)) continue
        const dot = value.indexOf(".")
        const op = { eq: "=", neq: "!=", gt: ">" }[value.slice(0, dot)]
        if (!op) throw new Error("Unsupported test operator")
        where.push(`${identifier(key)} ${op} ${bind(value.slice(dot + 1))}`)
      }
      if (where.length) query += ` where ${where.join(" and ")}`
    }
    if (method === "GET") {
      const order = url.searchParams.get("order")
      if (order) query += ` order by ${identifier(order.split(".")[0]!)} ${order.endsWith(".desc") ? "desc" : "asc"}`
      if (url.searchParams.has("limit")) query += ` limit ${bind(Number(url.searchParams.get("limit")))}`
    } else query += " returning *"
    return (await this.pg.query(query, params)).rows as T
  }
}
