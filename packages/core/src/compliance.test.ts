import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { CONTRACTS } from "./contracts.js"
import { GEO_LOOKUPS, GEOBLOCKED_COUNTRIES, isCountryCode } from "./compliance.js"
import { DEPLOYMENTS } from "./deployments.js"

// The web interface keeps its geo gate in its own hook. The CLI and the MCP server read these
// constants instead, so this test reads the hook and fails when the two drift apart.
const hook = readFileSync(new URL("../../../apps/web/src/hooks/useGeoblockCheck.ts", import.meta.url), "utf8")

test("GEOBLOCKED_COUNTRIES is the web's BLOCKED_COUNTRIES, code for code", () => {
  const set = /const BLOCKED_COUNTRIES = new Set\(\[([\s\S]*?)\]\)/.exec(hook)
  assert.ok(set, "BLOCKED_COUNTRIES not found in useGeoblockCheck.ts")
  const web = [...set[1]!.matchAll(/"([A-Z]{2})"/g)].map((m) => m[1])
  assert.deepEqual([...GEOBLOCKED_COUNTRIES].sort(), web.sort())
  assert.equal(new Set(GEOBLOCKED_COUNTRIES).size, GEOBLOCKED_COUNTRIES.length)
})

test("GEO_LOOKUPS are the web's lookups, in the web's order", () => {
  const web = [...hook.matchAll(/fetch\("(https:\/\/[^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual(GEO_LOOKUPS.map((l) => l.url), web)
})

test("the sanctions oracle the gates read is the interface's", () => {
  assert.equal(DEPLOYMENTS[1].sanctionsOracle, CONTRACTS.sanctionsList.address)
})

test("country codes reject unknown and proxy sentinels while accepting assigned territories", () => {
  for (const code of ["XX", "ZZ", "AA", "EU", "T1", "US ", "us", "", null, {}, 123]) {
    assert.equal(isCountryCode(code), false)
  }
  for (const code of ["US", "DE", "RU", "CN", "GB", "AQ", "AX", "BQ", "CW", "SS", "SX", "XK"]) {
    assert.equal(isCountryCode(code), true)
  }
  for (const code of GEOBLOCKED_COUNTRIES) assert.equal(isCountryCode(code), true)
})
