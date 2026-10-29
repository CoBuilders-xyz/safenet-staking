import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

// A leftover transport timer must not keep a completed or cancelled CLI invocation alive.
// Large buffered output proves the executable flushes before its deliberate exit.
test("the executable flushes piped output and exits despite a leftover transport timer", () => {
  const entry = new URL("./index.ts", import.meta.url).href
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    setInterval(() => {}, 60_000)
    process.stdout.write("x".repeat(500_000))
    process.stderr.write("y".repeat(500_000))
    process.argv = ["node", "safenet", "--help"]
    await import(${JSON.stringify(entry)})
  `], { encoding: "utf8", timeout: 10_000, maxBuffer: 2_000_000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.ok(result.stdout.startsWith("x".repeat(500_000)))
  assert.match(result.stdout.slice(500_000), /Usage: safenet/)
  assert.equal(result.stderr, "y".repeat(500_000))
})
