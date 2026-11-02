import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"
import { pathRelation } from "./path-containment.js"

let root: string
let insensitive: boolean
before(() => {
  root = mkdtempSync(join(tmpdir(), "snapshot-path-test-"))
  mkdirSync(join(root, "MixedCase"))
  insensitive = existsSync(join(root, "mixedcase"))
})
after(() => rmSync(root, { recursive: true, force: true }))

describe("filesystem path containment", () => {
  it("distinguishes equality, descendants and siblings without string-prefix matches", () => {
    const parent = join(root, "MixedCase")
    assert.equal(pathRelation(parent, parent), "equal")
    assert.equal(pathRelation(join(parent, "new", "nested"), parent), "inside")
    assert.equal(pathRelation(join(root, "MixedCase-other"), parent), "outside")
    assert.equal(pathRelation(root, parent), "outside")
  })

  it("compares case-variant existing ancestors by identity and preserves distinct case-sensitive directories", (t) => {
    const parent = join(root, "MixedCase")
    const variant = join(root, "mixedcase")
    if (!insensitive) mkdirSync(variant)
    t.diagnostic(`case-insensitive filesystem: ${insensitive}`)
    assert.equal(pathRelation(variant, parent), insensitive ? "equal" : "outside")
    assert.equal(pathRelation(join(variant, "publication"), parent), insensitive ? "inside" : "outside")
  })

  it("resolves symlinked ancestors for missing output directories", () => {
    const parent = join(root, "MixedCase")
    const alias = join(root, "alias")
    symlinkSync(parent, alias, "junction")
    assert.equal(pathRelation(alias, parent), "equal")
    assert.equal(pathRelation(join(alias, "new", "nested"), parent), "inside")
    assert.equal(pathRelation(join(alias, "new", "nested"), join(parent, "new")), "inside")
  })

  it("preserves containment and boundaries for absent directories", () => {
    assert.equal(pathRelation(join(root, "new", "index"), join(root, "new")), "inside")
    assert.equal(pathRelation(join(root, "new"), join(root, "new")), "equal")
    assert.equal(pathRelation(join(root, "newer"), join(root, "new")), "outside")
    assert.equal(pathRelation(join(root, "MixedCase"), join(root, "new")), "outside")
  })

  it("probes the filesystem before folding missing components and removes the probe", () => {
    const before = readdirSync(root, { recursive: true })
    assert.equal(pathRelation(join(root, "Future", "INDEX", "nested"), join(root, "future", "index")), insensitive ? "inside" : "outside")
    assert.equal(pathRelation(join(root, "Future"), join(root, "future")), insensitive ? "equal" : "outside")
    assert.deepEqual(readdirSync(root, { recursive: true }), before)
  })

  it("rejects broken symlinks instead of treating them as absent directories", () => {
    const broken = join(root, "broken")
    symlinkSync(join(root, "missing-target"), broken, "junction")
    assert.throws(() => pathRelation(join(broken, "new"), root), /ENOENT/)
  })
})
