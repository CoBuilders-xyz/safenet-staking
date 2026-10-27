import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { collect, type Dataset } from "./dataset.js"
import { fakeSources } from "./test-support.js"
import { manifestMismatch, serialise, writeDay } from "./write.js"

const tmp = () => mkdtempSync(join(tmpdir(), "snapshot-write-test-"))

test("amounts are decimal strings and dates ISO 8601, with a final newline", () => {
  const text = serialise({ wei: 10n ** 30n, at: new Date("2026-10-27T00:00:00Z") })
  assert.equal(text, '{\n  "wei": "1000000000000000000000000000000",\n  "at": "2026-10-27T00:00:00.000Z"\n}\n')
})

test("a day is written under its date, with the files its manifest lists and nothing left beside it", async () => {
  const out = tmp()
  try {
    const dir = writeDay(await collect(fakeSources()), out)
    assert.equal(dir, join(out, "2026-10-27"))
    assert.deepEqual(readdirSync(out), ["2026-10-27"])
    assert.equal(manifestMismatch(dir), undefined)
    assert.ok(readFileSync(join(dir, "sef/rewards/latest.json")).length > 0)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("a day already written is never overwritten", async () => {
  const out = tmp()
  try {
    const d = await collect(fakeSources())
    writeDay(d, out)
    assert.throws(() => writeDay(d, out), /already exists/)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("a day whose files do not match its manifest leaves no directory at all", async () => {
  const out = tmp()
  try {
    const d = await collect(fakeSources())
    const broken: Dataset = { ...d, raw: { ...d.raw, "sef/extra.json": new Uint8Array([1]) } }
    assert.throws(() => writeDay(broken, out), /do not match its manifest: not listed sef\/extra\.json/)
    assert.deepEqual(readdirSync(out), [])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("the manifest check names a missing and an unlisted file", () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ files: ["a.json", "b.json"] }))
    writeFileSync(join(dir, "a.json"), "{}")
    writeFileSync(join(dir, "c.json"), "{}")
    assert.equal(manifestMismatch(dir), "missing b.json; not listed c.json")
    rmSync(join(dir, "manifest.json"))
    assert.equal(manifestMismatch(dir), "there is no manifest.json")
    assert.ok(!existsSync(join(dir, "manifest.json")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
