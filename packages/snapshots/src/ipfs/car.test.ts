import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { listFiles, packDirectory, PackError } from "./car.js"

/** Two files, one in a subdirectory, as a snapshot holds sef/. */
function sample(): string {
  const dir = mkdtempSync(join(tmpdir(), "car-test-"))
  mkdirSync(join(dir, "sef"))
  writeFileSync(join(dir, "manifest.json"), '{"day":"2026-10-27"}\n')
  writeFileSync(join(dir, "sef", "validator-info.json"), "[]\n")
  return dir
}

test("the CID is the one `npx ipfs-car@3.1.0 pack` gives for the same files", async () => {
  // Computed with the ipfs-car 3.1.0 command line on these two files, on 2026-10-27.
  const dir = sample()
  try {
    const packed = await packDirectory(dir)
    assert.equal(packed.cid, "bafybeifoetp6ov5qxuhv73nrdfza2jcxorzyjxht2dnxp7disc35sygmle")
    assert.deepEqual(packed.files, ["manifest.json", "sef/validator-info.json"])
    assert.ok(packed.car.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("one changed byte gives another CID", async () => {
  const dir = sample()
  try {
    const before = (await packDirectory(dir)).cid
    writeFileSync(join(dir, "sef", "validator-info.json"), "[ ]\n")
    assert.notEqual((await packDirectory(dir)).cid, before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("files are listed in byte order, not locale order", () => {
  const dir = mkdtempSync(join(tmpdir(), "car-test-"))
  try {
    // Names that differ in more than case, because macOS file systems ignore case.
    for (const name of ["b.json", "Z.json", "a.json"]) writeFileSync(join(dir, name), "")
    assert.deepEqual(listFiles(dir), ["Z.json", "a.json", "b.json"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a dot-file or an empty directory is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "car-test-"))
  try {
    await assert.rejects(packDirectory(dir), (e: unknown) => e instanceof PackError && /no file to pack/.test(e.message))
    writeFileSync(join(dir, ".hidden"), "")
    await assert.rejects(packDirectory(dir), /dot-files, which the CID check would not cover: \.hidden/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
