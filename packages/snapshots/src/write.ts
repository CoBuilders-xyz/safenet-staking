/**
 * Writing a day's directory, all of it or nothing.
 *
 * The files are written to a hidden sibling directory, checked against the manifest, and only
 * then renamed to the day. A run that fails part-way leaves no directory under the day's name,
 * so nothing downstream can pack a partial day.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { listFiles } from "./ipfs/car.js"
import type { Dataset } from "./dataset.js"
import { SnapshotError } from "./errors.js"

/**
 * JSON as the snapshot writes it: two-space indent, a final newline, amounts that are bigints
 * as decimal strings, because JSON numbers lose precision past 2^53, and dates in ISO 8601.
 * Keys keep the order the dataset built them in, so the same data gives the same bytes.
 */
export function serialise(value: unknown): string {
  return `${JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`
}

/** The day's files, by path, as bytes. */
export function render(dataset: Dataset): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const [path, value] of Object.entries(dataset.json)) files.set(path, new TextEncoder().encode(serialise(value)))
  for (const [path, bytes] of Object.entries(dataset.raw)) files.set(path, bytes)
  return files
}

/**
 * The manifest's file list must be exactly the files present, apart from the manifest itself.
 * Returns the problem, or undefined.
 */
export function manifestMismatch(dir: string): string | undefined {
  const manifestPath = join(dir, "manifest.json")
  if (!existsSync(manifestPath)) return "there is no manifest.json"
  let listed: unknown
  try {
    listed = (JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: unknown }).files
  } catch {
    return "manifest.json is not valid JSON"
  }
  if (!Array.isArray(listed) || !listed.every((f) => typeof f === "string")) return "manifest.json lists no files"
  const present = listFiles(dir).filter((f) => f !== "manifest.json")
  const missing = listed.filter((f) => !present.includes(f))
  const extra = present.filter((f) => !listed.includes(f))
  if (missing.length || extra.length) {
    return [missing.length && `missing ${missing.join(", ")}`, extra.length && `not listed ${extra.join(", ")}`]
      .filter(Boolean).join("; ")
  }
  return undefined
}

/** Write the day under `out/<day>`, refusing to overwrite a day already there. Returns its path. */
export function writeDay(dataset: Dataset, out: string): string {
  const target = join(out, dataset.day)
  if (existsSync(target)) throw new SnapshotError(`${target} already exists. A snapshot is never overwritten; remove it to build again`)
  const partial = join(out, `.${dataset.day}.partial-${process.pid}`)
  rmSync(partial, { recursive: true, force: true })
  try {
    for (const [path, bytes] of render(dataset)) {
      const file = join(partial, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
    const mismatch = manifestMismatch(partial)
    if (mismatch) throw new SnapshotError(`the day's files do not match its manifest: ${mismatch}`)
    renameSync(partial, target)
  } finally {
    rmSync(partial, { recursive: true, force: true })
  }
  return target
}
