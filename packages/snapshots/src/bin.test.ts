import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { IPFS_GATEWAYS } from "@cobuilders/safenet-core"
import { emptyIndex } from "./date-index.js"
import { collect } from "./dataset.js"
import { listFiles, packDirectory } from "./ipfs/car.js"
import { fakeSources } from "./test-support.js"
import { writeDay } from "./write.js"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
let root: string
let day: string
let cid: string
let preload: string
let fixture: string

before(async () => {
  root = mkdtempSync(join(tmpdir(), "snapshot-bin-test-"))
  day = writeDay(await collect(fakeSources()), join(root, "days"))
  cid = (await packDirectory(day)).cid
  fixture = join(root, "files.json")
  writeFileSync(fixture, JSON.stringify(Object.fromEntries(
    listFiles(day).map(path => [path, readFileSync(join(day, path)).toString("base64")]),
  )))
  preload = join(root, "fetch.mjs")
  writeFileSync(preload, `
import { appendFileSync, readFileSync } from "node:fs";
const files = JSON.parse(readFileSync(process.env.SNAPSHOT_FIXTURE, "utf8"));
globalThis.fetch = async input => {
  const url = new URL(typeof input === "string" ? input : input.url ?? input.href);
  appendFileSync(process.env.SNAPSHOT_FETCH_LOG, url.origin + "\\n");
  if (process.env.SNAPSHOT_DENY_FETCH === "1") throw new Error("Unexpected fetch");
  const gateways = ${JSON.stringify(IPFS_GATEWAYS)};
  if (url.origin !== "https://fixture.invalid" && !(process.env.SNAPSHOT_MULTI_GATEWAY === "1" && gateways.includes(url.origin))) throw new Error("Unexpected origin");
  const path = url.pathname.split("/ipfs/" + process.env.SNAPSHOT_CID + "/")[1];
  if (!path || !Object.hasOwn(files, path)) return new Response("not found", { status: 404 });
  if ((process.env.SNAPSHOT_TAMPER === "1" || (process.env.SNAPSHOT_TAMPER_FIRST === "1" && url.origin === gateways[0])) && path === "sef/validator-info.json") return new Response("[]\\n");
  return new Response(Buffer.from(files[path], "base64"));
};
`)
})

after(() => rmSync(root, { recursive: true, force: true }))

function invoke(script: "publish" | "verify", args: string[], settings: Record<string, string> = {}) {
  const scratch = mkdtempSync(join(root, "child-"))
  const temporary = join(scratch, "tmp")
  mkdirSync(temporary)
  const log = join(scratch, "fetch.log")
  const child = spawnSync(process.execPath, [
    "--conditions=source", "--import", "tsx", "--import", pathToFileURL(preload).href,
    join(packageRoot, "src", "bin", `${script}.ts`), ...args,
  ], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 30_000,
    // Do not inherit credentials, GitHub output paths, or Node preloads.
    env: {
      PATH: process.env.PATH,
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
      SNAPSHOT_FIXTURE: fixture,
      SNAPSHOT_FETCH_LOG: log,
      SNAPSHOT_CID: cid,
      ...settings,
    },
  })
  assert.ifError(child.error)
  assert.equal(child.signal, null)
  return { child, temporary, log }
}

describe("snapshot CLI failure cleanup", () => {
  for (const alias of [false, true]) {
    it(`rejects a snapshot inside the output index${alias ? " through a symlinked ancestor" : ""}`, () => {
      const scratch = mkdtempSync(join(root, "snapshot-overlap-"))
      const output = join(scratch, "output")
      const snapshot = join(output, "index", basename(day))
      cpSync(day, snapshot, { recursive: true })
      const linked = join(scratch, "alias")
      if (alias) symlinkSync(output, linked, "junction")
      const before = Object.fromEntries(listFiles(snapshot).map(path => [path, readFileSync(join(snapshot, path), "utf8")]))
      const { child, log } = invoke("publish", ["--dir", snapshot, "--out", alias ? linked : output], {
        PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", GATEWAY_TIMEOUT_SECONDS: "0", SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, 1)
      assert.match(child.stderr, /--dir must not be inside <out>\/index/)
      assert.equal(existsSync(log), false)
      assert.doesNotMatch(child.stdout, /files, .* blocks, CID|pinned/)
      assert.deepEqual(Object.fromEntries(listFiles(snapshot).map(path => [path, readFileSync(join(snapshot, path), "utf8")])), before)
    })
  }

  for (const mismatch of [false, true]) {
    it(`${mismatch ? "rejects mismatched" : "accepts matching"} index bytes before the already-published shortcut`, async () => {
      const index = mkdtempSync(join(root, "index-cid-"))
      const contents = JSON.stringify({ ...emptyIndex(), days: { [basename(day)]: { cid } } })
      writeFileSync(join(index, "index.json"), contents)
      const expected = (await packDirectory(index)).cid
      writeFileSync(join(index, "INDEX_CID"), `${expected}\n`)
      if (mismatch) writeFileSync(join(index, "index.json"), `${contents}\n`)
      const output = join(index, "output")
      const { child, log, temporary } = invoke("publish", ["--dir", day, "--out", output, "--index", index], {
        SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, mismatch ? 1 : 0, child.stderr)
      if (mismatch) assert.match(child.stderr, /index\.json does not hash to INDEX_CID/)
      else assert.match(child.stdout, /already published/)
      assert.equal(existsSync(log), false)
      assert.equal(existsSync(output), false)
      assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith("snapshot-index-")), [])
      assert.equal(readFileSync(join(index, "index.json"), "utf8"), mismatch ? `${contents}\n` : contents)
      assert.equal(readFileSync(join(index, "INDEX_CID"), "utf8"), `${expected}\n`)
    })
  }

  for (const target of [".", "index", "index/nested"]) {
    it(`rejects a symlink alias to output/${target} before reading or changing files`, () => {
      const scratch = mkdtempSync(join(root, "symlink-overlap-"))
      const output = join(scratch, "output")
      const input = join(output, target)
      mkdirSync(input, { recursive: true })
      writeFileSync(join(input, "index.json"), "not JSON")
      writeFileSync(join(input, "INDEX_CID"), `${cid}\n`)
      const alias = join(scratch, "alias")
      symlinkSync(input, alias, "junction")
      const before = Object.fromEntries(listFiles(output).map(path => [path, readFileSync(join(output, path), "utf8")]))
      const { child, log } = invoke("publish", ["--dir", day, "--out", output, "--index", alias], {
        PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, 1)
      assert.match(child.stderr, /--index must not be --out or inside <out>\/index/)
      assert.equal(existsSync(log), false)
      assert.doesNotMatch(child.stdout, /files, .* blocks, CID|pinned/)
      assert.deepEqual(Object.fromEntries(listFiles(output).map(path => [path, readFileSync(join(output, path), "utf8")])), before)
    })
  }

  it("rejects overlap through a symlinked output ancestor when the output does not exist", () => {
    const scratch = mkdtempSync(join(root, "ancestor-overlap-"))
    const actual = join(scratch, "actual")
    const alias = join(scratch, "alias")
    mkdirSync(actual)
    symlinkSync(actual, alias, "junction")
    const { child, log } = invoke("publish", ["--dir", day, "--out", join(alias, "new"), "--index", join(actual, "new", "index", "nested")], {
      PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", GATEWAY_TIMEOUT_SECONDS: "0", SNAPSHOT_DENY_FETCH: "1",
    })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /--index must not be --out or inside <out>\/index/)
    assert.equal(existsSync(log), false)
    assert.deepEqual(readdirSync(actual), [])
  })

  it("allows first publication to separate missing directories through a symlinked ancestor", () => {
    const scratch = mkdtempSync(join(root, "ancestor-separate-"))
    const actual = join(scratch, "actual")
    const alias = join(scratch, "alias")
    mkdirSync(actual)
    symlinkSync(actual, alias, "junction")
    const { child, log } = invoke("publish", ["--dir", day, "--out", join(alias, "publish"), "--index", join(actual, "index-current")], {
      PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", GATEWAY_TIMEOUT_SECONDS: "0", SNAPSHOT_DENY_FETCH: "1",
    })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /GATEWAY_TIMEOUT_SECONDS must be a positive number/)
    assert.equal(existsSync(log), false)
    assert.deepEqual(readdirSync(actual), [])
  })

  for (const overlap of [".", "index", "index/nested", "index/../index/nested"]) {
    it(`rejects overlapping index path ${overlap} before reading or changing files`, () => {
      const output = mkdtempSync(join(root, "overlap-"))
      const index = join(output, overlap)
      mkdirSync(index, { recursive: true })
      // Invalid JSON proves the path guard runs before reading the index.
      writeFileSync(join(index, "index.json"), "not JSON")
      writeFileSync(join(index, "INDEX_CID"), `${cid}\n`)
      const before = Object.fromEntries(listFiles(output).map(path => [path, readFileSync(join(output, path), "utf8")]))
      const { child, log } = invoke("publish", ["--dir", day, "--out", output, "--index", index], {
        PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, 1)
      assert.match(child.stderr, /--index must not be --out or inside <out>\/index/)
      assert.doesNotMatch(child.stdout, /files, .* blocks, CID|pinned/)
      assert.equal(existsSync(log), false)
      assert.deepEqual(Object.fromEntries(listFiles(output).map(path => [path, readFileSync(join(output, path), "utf8")])), before)
    })
  }

  it("allows a separate input with the output index directory as a name prefix", () => {
    const output = mkdtempSync(join(root, "separate-index-"))
    const index = join(output, "index-current")
    mkdirSync(index)
    const { child, log } = invoke("publish", ["--dir", day, "--out", output, "--index", index], {
      PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", GATEWAY_TIMEOUT_SECONDS: "0", SNAPSHOT_DENY_FETCH: "1",
    })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /GATEWAY_TIMEOUT_SECONDS must be a positive number/)
    assert.equal(existsSync(log), false)
    assert.equal(existsSync(join(output, "index")), false)
  })

  for (const present of ["INDEX_CID", "index.json"]) {
    it(`rejects an index with only ${present} before packing or pinning`, () => {
      const index = mkdtempSync(join(root, "incomplete-index-"))
      writeFileSync(join(index, present), present === "INDEX_CID" ? `${cid}\n` : JSON.stringify(emptyIndex()))
      const output = join(index, "output")
      const { child, log } = invoke("publish", ["--dir", day, "--out", output, "--index", index], {
        PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, 1)
      assert.match(child.stderr, /index\.json and INDEX_CID must both exist/)
      assert.doesNotMatch(child.stdout, /files, .* blocks, CID|pinned/)
      assert.equal(existsSync(log), false)
      assert.equal(existsSync(output), false)
    })
  }

  it("an empty index directory remains a valid first-publication input", () => {
    const index = mkdtempSync(join(root, "first-index-"))
    const { child, log } = invoke("publish", ["--dir", day, "--out", join(index, "output"), "--index", index], {
      PINATA_JWT: "fixture-only-not-a-token", PINATA_GATEWAY: "fixture.invalid", GATEWAY_TIMEOUT_SECONDS: "0", SNAPSHOT_DENY_FETCH: "1",
    })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /GATEWAY_TIMEOUT_SECONDS must be a positive number/)
    assert.equal(existsSync(log), false)
  })

  it("tries the next gateway after a CID mismatch and removes both temporary directories", () => {
    const { child, temporary, log } = invoke("verify", [cid], { SNAPSHOT_MULTI_GATEWAY: "1", SNAPSHOT_TAMPER_FIRST: "1" })
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stderr, /MISMATCH: expected/)
    assert.match(child.stdout, /OK, identical to/)
    const origins = new Set(readFileSync(log, "utf8").trim().split("\n"))
    assert.deepEqual(origins, new Set(IPFS_GATEWAYS.slice(0, 2)))
    assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith("snapshot-verify-")), [])
  })

  it("fails after every gateway serves a CID mismatch and removes all temporary directories", () => {
    const { child, temporary, log } = invoke("verify", [cid], { SNAPSHOT_MULTI_GATEWAY: "1", SNAPSHOT_TAMPER: "1" })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /no gateway served/)
    assert.match(child.stderr, /MISMATCH: expected/)
    assert.doesNotMatch(child.stdout, /OK, identical to/)
    assert.deepEqual(new Set(readFileSync(log, "utf8").trim().split("\n")), new Set(IPFS_GATEWAYS))
    assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith("snapshot-verify-")), [])
  })

  for (const timeout of ["0", "-1", "not-a-number", "Infinity"]) {
    it(`rejects timeout ${timeout} before packing or pinning`, () => {
      const output = join(root, `publish-${timeout}`)
      const { child, log } = invoke("publish", ["--dir", day, "--out", output], {
        PINATA_JWT: "fixture-only-not-a-token",
        PINATA_GATEWAY: "fixture.invalid",
        GATEWAY_TIMEOUT_SECONDS: timeout,
        SNAPSHOT_DENY_FETCH: "1",
      })
      assert.equal(child.status, 1)
      assert.match(child.stderr, /GATEWAY_TIMEOUT_SECONDS must be a positive number/)
      assert.doesNotMatch(child.stdout, /files, .* blocks, CID|pinned/)
      assert.equal(existsSync(log), false, "invalid configuration must not reach fetch")
      assert.equal(existsSync(output), false, "invalid configuration must not write publication outputs")
    })
  }

  it("removes downloaded files before exiting on a CID mismatch", () => {
    const { child, temporary, log } = invoke("verify", [cid, "--gateway", "https://fixture.invalid"], {
      SNAPSHOT_TAMPER: "1",
    })
    assert.equal(child.status, 1)
    assert.match(child.stderr, /MISMATCH: expected/)
    assert.match(child.stdout, /manifest lists exactly the files present/)
    assert.ok(readFileSync(log, "utf8").split("\n").length > 2)
    assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith("snapshot-verify-")), [])
  })

  it("removes downloaded files after successful CID verification", () => {
    const { child, temporary } = invoke("verify", [cid, "--gateway", "https://fixture.invalid"])
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /OK, identical to/)
    assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith("snapshot-verify-")), [])
  })
})
