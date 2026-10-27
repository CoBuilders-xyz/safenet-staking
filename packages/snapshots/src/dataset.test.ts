import assert from "node:assert/strict"
import { test } from "node:test"
import { GNOSIS_INDEXED_PROGRAMME } from "@cobuilders/safenet-core"
import { collect, SNAPSHOT_SCHEMA, type At, type Dataset } from "./dataset.js"
import { SnapshotError } from "./errors.js"
import {
  BLOCK, COMMIT, GNOSIS_BLOCK, REWARDS_COMMIT, fakeSources, mainnetFixture, sefFixture,
} from "./test-support.js"
import { render, serialise } from "./write.js"

type Json = Record<string, unknown>
const file = (d: Dataset, name: string) => JSON.parse(serialise(d.json[name])) as Json

/** Every object with `value` and `source`, anywhere in a file: the figures. */
function figures(value: unknown, path = "$"): { path: string; fig: Json }[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => figures(v, `${path}[${i}]`))
  if (value === null || typeof value !== "object") return []
  const o = value as Json
  if ("value" in o && "source" in o && path.split(".").at(-1) !== "programme" && !path.includes(".programme.")) return [{ path, fig: o }]
  return Object.entries(o).flatMap(([k, v]) => figures(v, `${path}.${k}`))
}

test("a day holds the six JSON files and SEF's three files, as the manifest lists them", async () => {
  const d = await collect(fakeSources())
  const names = [...render(d).keys()].sort()
  assert.deepEqual(names, [
    "manifest.json", "network.json", "participation.json", "rewards.json",
    "sef/network-info.json", "sef/rewards/latest.json", "sef/validator-info.json", "validators.json", "withdrawals.json",
  ])
  const manifest = file(d, "manifest.json")
  assert.equal(manifest.schema, SNAPSHOT_SCHEMA)
  assert.equal(manifest.day, "2026-10-27")
  assert.deepEqual(manifest.files, names.filter((n) => n !== "manifest.json"))
})

test("SEF's files are copied byte for byte, as published at their commit", async () => {
  const d = await collect(fakeSources())
  for (const path of ["validator-info.json", "network-info.json", "rewards/latest.json"]) {
    assert.deepEqual(d.raw[`sef/${path}`], sefFixture(path))
  }
  const sef = (file(d, "manifest.json").sef as { files: { path: string; commit: string }[] }).files
  assert.deepEqual(sef.map((f) => [f.path, f.commit]), [
    ["validator-info.json", COMMIT], ["network-info.json", COMMIT], ["rewards/latest.json", REWARDS_COMMIT],
  ])
})

test("every figure names its block or its SEF commit", async () => {
  const d = await collect(fakeSources())
  let count = 0
  for (const name of ["network.json", "validators.json", "withdrawals.json", "rewards.json"]) {
    for (const { path, fig } of figures(file(d, name))) {
      count++
      const at = fig.at as Json[] | undefined
      assert.ok(Array.isArray(at) && at.length > 0, `${name} ${path} names no block or commit`)
      for (const a of at) {
        const ok = (a.chain === "mainnet" && a.block === String(BLOCK)) ||
          (a.sef !== undefined && (a.commit === COMMIT || a.commit === REWARDS_COMMIT))
        assert.ok(ok, `${name} ${path}: ${JSON.stringify(a)}`)
      }
    }
  }
  assert.ok(count >= 30, `only ${count} figures found`)
})

test("a figure read from both the chain and SEF's file names both", async () => {
  const network = file(await collect(fakeSources()), "network.json")
  const at = (network.registeredValidators as { at: At[] }).at
  assert.deepEqual(at, [{ chain: "mainnet", block: String(BLOCK) }, { sef: "validator-info.json", commit: COMMIT }])
})

test("subgraph rows name the block and the deployment they were read at", async () => {
  const d = await collect(fakeSources())
  const withdrawals = file(d, "withdrawals.json").withdrawals as Json
  assert.deepEqual(withdrawals.at, { chain: "mainnet", block: String(BLOCK) })
  assert.equal(withdrawals.deployment, "QmMainnet")
  assert.equal((withdrawals.rows as unknown[]).length, (mainnetFixture().withdrawals as unknown[]).length)
  const hours = file(d, "participation.json").validatorHours as Json
  assert.deepEqual(hours.at, { chain: "gnosis", block: String(GNOSIS_BLOCK) })
})

test("a validator only the subgraph has seen is kept, with SEF's fields null and the reason", async () => {
  const validators = file(await collect(fakeSources()), "validators.json").validators as Json[]
  assert.equal(validators.length, 3)
  const unlisted = validators[2]!
  assert.equal((unlisted.label as Json).value, null)
  assert.match((unlisted.label as Json).reason as string, /does not list it/)
  assert.equal((unlisted.registered as Json).value, false)
  assert.equal((unlisted.delegators as Json).value, null)
  assert.ok((unlisted.registration as Json).row, "its subgraph row, the registration record, is kept")
})

test("each validator carries its delegations and its stake and withdrawal events, and only its own", async () => {
  const validators = file(await collect(fakeSources()), "validators.json").validators as Json[]
  for (const v of validators) {
    const id = (v.address as string).toLowerCase()
    const events = v.events as { stakes: { rows: Json[] }; withdrawals: { rows: Json[] } }
    for (const r of [...(v.delegations as { rows: Json[] }).rows, ...events.stakes.rows, ...events.withdrawals.rows]) {
      assert.equal(r.validator, id)
    }
  }
  const first = validators[0]!
  assert.ok(((first.delegations as { rows: unknown[] }).rows.length) > 0)
})

test("the open withdrawal queues are read for every staker with an unclaimed withdrawal", async () => {
  const w = file(await collect(fakeSources()), "withdrawals.json")
  const queues = (w.queues as { value: { staker: string; withdrawals: { amount: { wei: string } }[] }[] }).value
  const open = (mainnetFixture().withdrawals as unknown as { claimed: boolean; staker: string }[]).filter((r) => !r.claimed)
  assert.equal(queues.length, new Set(open.map((r) => r.staker)).size)
  const sum = queues.flatMap((q) => q.withdrawals).reduce((s, x) => s + BigInt(x.amount.wei), 0n)
  assert.equal(String(sum), (w.total as Json).value)
})

test("without a programme field, the Gnosis buckets are named by core's indexed programme", async () => {
  const p = file(await collect(fakeSources()), "participation.json")
  const programme = p.programme as Record<string, Json>
  assert.equal(programme.validatorHours!.value, GNOSIS_INDEXED_PROGRAMME)
  assert.match(programme.validatorHours!.source as string, /GNOSIS_INDEXED_PROGRAMME/)
  assert.deepEqual((p.validatorHours as Json).absentFields, ["programme"])
})

test("with a programme field, as the Aegis schema has, each bucket row carries it", async () => {
  const p = file(await collect(fakeSources({
    gnosis: { programme: ["Consensus", "ConsensusDay", "ValidatorDay", "ConsensusHour", "ValidatorHour"] },
  })), "participation.json")
  const programme = p.programme as Record<string, Json>
  assert.equal(programme.validatorHours!.value, null)
  assert.match(programme.validatorHours!.source as string, /ValidatorHour\.programme/)
  const rows = (p.validatorHours as { rows: Json[]; absentFields: string[] })
  assert.deepEqual(rows.absentFields, [])
  assert.ok(rows.rows.every((r) => r.programme === "aegis"))
})

test("a field the deployment lacks is left out and named, not a failure", async () => {
  const d = await collect(fakeSources({ mainnet: { absent: { Validator: ["registeredAtTimestamp"] } } }))
  const v = (file(d, "validators.json").validators as Json[])[0]!
  const registration = v.registration as { absentFields: string[]; row: Json }
  assert.ok(registration.absentFields.includes("registeredAtTimestamp"))
  assert.equal(registration.row.registeredAtTimestamp, undefined)
})

// --- Days that must not be published ---

test("a missing figure aborts the day: the subgraph has no Network row", async () => {
  // The type exists; the row with id "1" does not.
  const fixture = mainnetFixture()
  fixture.network = { ...(fixture.network as { id: string }), id: "2" }
  await assert.rejects(collect(fakeSources({ mainnetFixture: fixture })), (e: unknown) =>
    e instanceof SnapshotError && /no network "1"/.test(e.message))
})

test("a missing figure aborts the day: SEF's network-info.json lost a field the CLI reads", async () => {
  const shape = new Error("SEF's network-info.json no longer has the shape this tool reads")
  await assert.rejects(collect(fakeSources({ statusError: shape })), /no longer has the shape/)
})

test("a missing figure aborts the day: the delegators could not be counted", async () => {
  await assert.rejects(collect(fakeSources({ delegatorsUnavailable: true })), (e: unknown) =>
    e instanceof SnapshotError && /could not be counted/.test(e.message))
})

test("a missing figure aborts the day: a Gnosis entity the deployment does not have", async () => {
  await assert.rejects(collect(fakeSources({ gnosis: { absent: { ConsensusHour: ["hour", "attestationCeremonies", "attestationCeremoniesOnTheHour", "id"] } } })),
    /no type ConsensusHour/)
})

test("a figure read at another block than the pin aborts the day", async () => {
  await assert.rejects(collect(fakeSources({ block: BLOCK + 1n })), /not the pinned block/)
})

test("an unknown participation window aborts the day", async () => {
  const window = { days: 14, start: null, end: null, publishedAt: null, commit: null, unknownBecause: "the GitHub API answered HTTP 403" }
  await assert.rejects(collect(fakeSources({ window })), /participation window is unknown: the GitHub API answered HTTP 403/)
})

test("the chain and the subgraph disagreeing at the same block aborts the day, naming the figure", async () => {
  await assert.rejects(collect(fakeSources({ totalStakedOffset: 1n })), (e: unknown) =>
    e instanceof SnapshotError && /Network\.totalStaked equals Staking\.totalStakedAmount\(\)/.test(e.message))
})

test("a subgraph on another fork than the RPC aborts the day", async () => {
  await assert.rejects(collect(fakeSources({ mainnet: { hash: `0x${"ef".repeat(32)}` } })), /no block with that hash/)
})

test("the same sources give the same bytes", async () => {
  const a = render(await collect(fakeSources()))
  const b = render(await collect(fakeSources()))
  assert.deepEqual([...a.entries()], [...b.entries()])
})
