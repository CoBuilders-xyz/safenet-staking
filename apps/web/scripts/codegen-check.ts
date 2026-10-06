/**
 * Fails when the committed GraphQL types are stale.
 *
 * Regenerates into a temporary directory and compares with src/graphql. A schema.graphql in a
 * subgraph package, or a document here, that changed without `pnpm codegen` fails this, and so
 * fails `pnpm check`.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const CHAINS = ["mainnet", "gnosis"]
const out = mkdtempSync(join(tmpdir(), "safenet-codegen-"))

try {
  execFileSync("pnpm", ["exec", "graphql-codegen", "--config", "codegen.ts", "--errors-only"], {
    cwd: ROOT,
    env: { ...process.env, CODEGEN_OUT: out },
    stdio: ["ignore", "ignore", "inherit"],
  })
  const stale = CHAINS.filter((chain) => {
    const committed = join(ROOT, "src/graphql", chain, "generated.ts")
    const fresh = join(out, chain, "generated.ts")
    return readFileSync(committed, "utf8") !== readFileSync(fresh, "utf8")
  })
  if (stale.length > 0) {
    console.error(`  stale GraphQL types: ${stale.map((c) => `src/graphql/${c}/generated.ts`).join(", ")}`)
    console.error("  run `pnpm --filter @cobuilders/safenet-web codegen` and commit the result")
    process.exitCode = 1
  } else {
    console.log("  GraphQL types match the subgraph schemas and documents")
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}
