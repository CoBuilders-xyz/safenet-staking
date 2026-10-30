import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
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
  appendFileSync(process.env.SNAPSHOT_FETCH_LOG, "fetch\\n");
  if (process.env.SNAPSHOT_DENY_FETCH === "1") throw new Error("Unexpected fetch");
  const url = new URL(typeof input === "string" ? input : input.url ?? input.href);
  if (url.origin !== "https://fixture.invalid") throw new Error("Unexpected origin");
  const path = url.pathname.split("/ipfs/" + process.env.SNAPSHOT_CID + "/")[1];
  if (!path || !Object.hasOwn(files, path)) return new Response("not found", { status: 404 });
  if (process.env.SNAPSHOT_TAMPER === "1" && path === "sef/validator-info.json") return new Response("[]\\n");
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
