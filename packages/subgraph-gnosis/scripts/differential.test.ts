import { strict as assert } from "node:assert"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"

const end = (utcDayMs(BETA_END_DAY) + 86_400_000) / 1000
const start = end - 14 * 86_400
function fixture() {
  return {
    oracle: {
      programme: "beta", gnosisBlock: "3000", windowDays: 14,
      window: { start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString(), fromBlock: "1000", toBlock: "2000" },
      ceremonies: { all: 3, attestations: 2 },
      participation: [
        { label: "Attending", address: "attending", ours: 1, rounds: 2 },
        { label: "Absent", address: "absent", ours: 0, rounds: 0 },
      ],
    },
    indexed: 3000, errors: false, earliest: start - 10_800,
    consensus: { validatorCount: 2, validators: [{ id: "attending" }, { id: "absent" }],
      attestationCeremonies: "2", nonAttestationCeremonies: "1", openCeremonies: 0 },
    // Also answer the old query, so this fixture demonstrates the original false failure.
    validatorDays: [{ attended: "2", validator: { id: "attending" } }],
    hours: [{ id: "a", hour: start, attestationCeremonies: 2, attestationCeremoniesOnTheHour: 0 }],
    validatorHours: [{ id: "a", hour: start, attended: 2, attendedOnTheHour: 0, validator: { id: "attending" } }],
  }
}
function run(input: ReturnType<typeof fixture>) {
  const dir = mkdtempSync(join(tmpdir(), "gnosis-differential-"))
  try {
    writeFileSync(join(dir, "oracle.json"), JSON.stringify(input.oracle))
    writeFileSync(join(dir, "fixture.json"), JSON.stringify(input))
    writeFileSync(join(dir, "mock.mjs"), `
      import { readFileSync } from "node:fs";
      const f = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
      globalThis.fetch = async (_url, options) => {
        const q = JSON.parse(options.body).query;
        let data;
        if (q.includes("_meta")) data = {
          _meta: { block: { number: f.indexed }, hasIndexingErrors: f.errors },
          consensus: f.consensus, consensusHours: [{ hour: f.earliest }], validatorDays: f.validatorDays,
        };
        else if (q.includes("consensus(id:")) data = { consensus: f.consensus };
        else {
          if (!q.includes('block: { number: ' + f.indexed + ' }') || !q.includes('programme: "beta"')) {
            throw new Error("hourly queries must pin the snapshot and programme");
          }
          const entity = q.includes("validatorHours(") ? "validatorHours" : "consensusHours";
          const after = q.match(/id_gt: "([^"]*)"/)[1];
          const rows = entity === "validatorHours" ? f.validatorHours : f.hours;
          data = { [entity]: rows.filter(r => r.id > after).slice(0, 1000) };
        }
        return new Response(JSON.stringify({ data }));
      };
    `)
    const child = spawnSync(process.execPath, ["--import", "tsx", "--import", join(dir, "mock.mjs"),
      fileURLToPath(new URL("./differential.ts", import.meta.url))], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, ORACLE: join(dir, "oracle.json"), ORACLE_DAYS: "14", PROGRAMME: "beta" },
    })
    return { status: child.status, output: child.stdout + child.stderr }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("zero attendance keeps a known programme validator in the comparison", () => {
  const result = run(fixture())
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /Absent: attended oracle 0, subgraph 0/)
})

test("historical window excludes later activity and includes only the final boundary block", () => {
  const f = fixture()
  f.hours.push({ id: "b", hour: end, attestationCeremonies: 20, attestationCeremoniesOnTheHour: 1 })
  f.validatorHours.push({ id: "b", hour: end, attended: 20, attendedOnTheHour: 1, validator: { id: "attending" } })
  f.oracle.ceremonies.attestations = 3
  f.oracle.participation[0]!.rounds = 3
  // Lifetime daily totals would include the later activity and fail this comparison.
  f.consensus.attestationCeremonies = "22"
  f.validatorDays[0]!.attended = "22"
  const result = run(f)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /attestation ceremonies: oracle 3, subgraph 3/)
})

test("all hourly pages use the same snapshot", () => {
  const f = fixture()
  f.validatorHours = Array.from({ length: 1001 }, (_, i) => ({
    id: String(i).padStart(4, "0"), hour: start, attended: i === 1000 ? 2 : 0,
    attendedOnTheHour: 0, validator: { id: "attending" },
  }))
  const result = run(f)
  assert.equal(result.status, 0, result.output)
})

test("real attendance disagreement fails", () => {
  const f = fixture()
  f.validatorHours[0]!.attended = 1
  const result = run(f)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /FAIL.*Attending/)
})

test("missing window, wrong programme, indexing errors and incomplete history fail", () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { delete (f.oracle as Partial<typeof f.oracle>).window },
    (f: ReturnType<typeof fixture>) => { f.oracle.programme = "aegis" },
    (f: ReturnType<typeof fixture>) => { f.errors = true },
    (f: ReturnType<typeof fixture>) => { f.indexed = 1500 },
    (f: ReturnType<typeof fixture>) => { f.earliest = start },
    (f: ReturnType<typeof fixture>) => { f.earliest = start - 7200 },
    (f: ReturnType<typeof fixture>) => { f.consensus.validatorCount = 3 },
  ]
  for (const change of changes) {
    const f = fixture()
    change(f)
    const result = run(f)
    assert.equal(result.status, 1, result.output)
  }
})
