import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { collect } from "./dataset.js"
import { listFiles, packDirectory } from "./ipfs/car.js"
import { fakeSources } from "./test-support.js"
import { fetchSnapshot, verifyDirectory } from "./verify.js"
import { writeDay } from "./write.js"

let out: string
let day: string
let cid: string

before(async () => {
  out = mkdtempSync(join(tmpdir(), "snapshot-verify-test-"))
  day = writeDay(await collect(fakeSources()), out)
  cid = (await packDirectory(day)).cid
})
after(() => rmSync(out, { recursive: true, force: true }))

/** A gateway serving the day's files under `cid`, with an optional change to one file. */
function gateway(tamper: { path: string; body: string | null } | null = null): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    const m = new RegExp(`^https://gw\\.example/ipfs/${cid}/(.+)$`).exec(url)
    const path = m?.[1]
    if (!path || !listFiles(day).includes(path)) return new Response("not found", { status: 404 })
    if (tamper?.path === path) return tamper.body === null ? new Response("not found", { status: 404 }) : new Response(tamper.body)
    return new Response(readFileSync(join(day, path)))
  }) as typeof fetch
  return { fetch: fetcher, urls }
}

test("a day's directory hashes to its CID, and its manifest lists exactly its files", async () => {
  const v = await verifyDirectory(day, cid)
  assert.equal(v.derived, cid)
  assert.equal(v.matches, true)
  assert.equal(v.manifest, "lists exactly the files present")
})

test("one changed byte in a file is a mismatch", async () => {
  const copy = mkdtempSync(join(tmpdir(), "snapshot-verify-test-"))
  try {
    cpSync(day, copy, { recursive: true })
    const network = join(copy, "network.json")
    writeFileSync(network, readFileSync(network, "utf8").replace('"activeValidators"', '"activeValidatorz"'))
    const v = await verifyDirectory(copy, cid)
    assert.equal(v.matches, false)
    assert.notEqual(v.derived, cid)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
})

test("from a CID, every file the manifest lists is fetched by path and re-packed to the same CID", async () => {
  const gw = gateway()
  const dir = await fetchSnapshot(cid, "https://gw.example", gw.fetch)
  try {
    assert.equal((await verifyDirectory(dir, cid)).matches, true)
    assert.equal(gw.urls.length, listFiles(day).length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a gateway that serves one altered file is caught by the CID", async () => {
  const gw = gateway({ path: "sef/validator-info.json", body: "[]\n" })
  const dir = await fetchSnapshot(cid, "https://gw.example", gw.fetch)
  try {
    const v = await verifyDirectory(dir, cid)
    assert.equal(v.matches, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a file the manifest lists and the gateway does not serve fails the fetch", async () => {
  const gw = gateway({ path: "rewards.json", body: null })
  await assert.rejects(fetchSnapshot(cid, "https://gw.example", gw.fetch), /lists rewards\.json, and the gateway answered 404/)
})

test("a manifest that lists a path outside the directory is refused", async () => {
  const evil = (async (input: RequestInfo | URL) =>
    String(input).endsWith("manifest.json")
      ? new Response(JSON.stringify({ files: ["../escape.json"] }))
      : new Response("x")) as typeof fetch
  await assert.rejects(fetchSnapshot(cid, "https://gw.example", evil), /unsafe path: \.\.\/escape\.json/)
})

test("an index, a directory holding index.json alone, is fetched and verified the same way", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-verify-test-"))
  try {
    writeFileSync(join(dir, "index.json"), '{"schema":"safenet-snapshots-index/1","previous":null,"days":{}}\n')
    const indexCid = (await packDirectory(dir)).cid
    const fetcher = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/index.json") ? new Response(readFileSync(join(dir, "index.json"))) : new Response("", { status: 404 })) as typeof fetch
    const fetched = await fetchSnapshot(indexCid, "https://gw.example", fetcher)
    try {
      const v = await verifyDirectory(fetched, indexCid)
      assert.equal(v.matches, true)
      assert.equal(v.manifest, null)
    } finally {
      rmSync(fetched, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
