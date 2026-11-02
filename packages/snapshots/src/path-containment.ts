import { lstatSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

type Identity = { dev: bigint; ino: bigint }
export type PathRelation = "equal" | "inside" | "outside"

/** Directory identity handles case aliases without conflating distinct names on sensitive filesystems. */
function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/** Resolve symlinks in the existing prefix; retain absent components for first publication. */
function existingAncestor(path: string) {
  let anchor = resolve(path)
  const missing: string[] = []
  while (!lstatSync(anchor, { throwIfNoEntry: false })) {
    missing.unshift(basename(anchor))
    const parent = dirname(anchor)
    if (parent === anchor) throw new Error(`No existing ancestor for ${path}`)
    anchor = parent
  }
  // A broken symlink is present to lstat, but realpath rejects it instead of guessing its target.
  anchor = realpathSync(anchor)
  return { anchor, missing, identity: statSync(anchor, { bigint: true }) }
}

/** Probe only ambiguous absent names, on their actual filesystem; remove all probe files on exit. */
function ignoresCase(directory: string): boolean {
  const probe = mkdtempSync(join(directory, ".snapshot-case-"))
  try {
    const file = join(probe, "case-probe")
    writeFileSync(file, "", { flag: "wx" })
    const variant = statSync(join(probe, "CASE-PROBE"), { bigint: true, throwIfNoEntry: false })
    return variant !== undefined && sameIdentity(statSync(file, { bigint: true }), variant)
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/**
 * Compare directory containment by filesystem identity, including symlink and case aliases.
 * Missing suffixes can overlap only under the same existing ancestor. Fold their case only
 * after probing that directory's filesystem; probe/access failures propagate before publication.
 */
export function pathRelation(candidate: string, directory: string): PathRelation {
  const child = existingAncestor(candidate)
  const parent = existingAncestor(directory)
  if (parent.missing.length === 0) {
    let ancestor = child.anchor
    let equal = child.missing.length === 0
    for (;;) {
      if (sameIdentity(statSync(ancestor, { bigint: true }), parent.identity)) return equal ? "equal" : "inside"
      const next = dirname(ancestor)
      if (next === ancestor) return "outside"
      ancestor = next
      equal = false
    }
  }

  // An existing child cannot be below an absent directory. Different anchors cannot overlap
  // beneath the parent's first absent component either.
  if (!sameIdentity(child.identity, parent.identity) || child.missing.length < parent.missing.length) return "outside"
  const prefix = child.missing.slice(0, parent.missing.length)
  if (!prefix.every((part, i) => part === parent.missing[i])) {
    if (!prefix.every((part, i) => part.toLowerCase() === parent.missing[i]!.toLowerCase())) return "outside"
    if (!ignoresCase(parent.anchor)) return "outside"
  }
  return child.missing.length === parent.missing.length ? "equal" : "inside"
}
