import { readdir, readFile } from "node:fs/promises"
import { URL } from "node:url"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { Database } from "../db.js"

const migrations = new URL("../../migrations/", import.meta.url)

/**
 * Applies every migration in file order, each in one batch, as `cf d1 migrations apply` does.
 * `only` selects files, for a test that upgrades a database with rows in it.
 */
export async function applyMigrations(d1: D1Database, only: (file: string) => boolean = () => true) {
  for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort().filter(only)) {
    const statements = (await readFile(new URL(file, migrations), "utf8")).replace(/^\s*--.*$/gm, "")
      .split(/;\s*$/m).map(statement => statement.trim()).filter(Boolean)
    await d1.batch(statements.map(statement => d1.prepare(statement)))
  }
}

/** For tests whose code path never reaches the database. */
export const noDatabase = new Proxy({}, { get() { throw new Error("This test must not use the database") } }) as D1Database

/** A fresh D1 database in workerd, through Miniflare: real D1 semantics, no mock of the queries. */
export class TestDatabase extends Database {
  private constructor(d1: D1Database, private readonly runtime: Miniflare) { super(d1) }
  static async create(only?: (file: string) => boolean) {
    const runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: "export default {}", d1Databases: { DB: crypto.randomUUID() },
    }))
    const d1 = await runtime.getD1Database("DB") as unknown as D1Database
    await applyMigrations(d1, only)
    return new TestDatabase(d1, runtime)
  }
  /** Applies the migrations `create` left out. */
  migrate(only: (file: string) => boolean) { return applyMigrations(this.d1, only) }
  /** Raw SQL for test setup and inspection. */
  async query<T = Record<string, unknown>>(sql: string, ...values: unknown[]): Promise<T[]> {
    return (await this.d1.prepare(sql).bind(...values).all<T>()).results
  }
  close() { return this.runtime.dispose() }
}

/** An ISO timestamp `ms` milliseconds from now, in the database's format. */
export const at = (ms: number) => new Date(Date.now() + ms).toISOString()
