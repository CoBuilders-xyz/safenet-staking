/**
 * Auditing a snapshot without our infrastructure: re-derive its CID from its files.
 *
 * A CID is a hash of the exact files and of how they were packed. So packing the files again
 * with the same settings, ipfs-car 3.1.0's defaults, must give the same CID. From a CID, the
 * files are fetched by path through any gateway and packed here; a gateway that served one byte
 * other than the pinned file, or left out a file, produces another CID, so the gateway need not
 * be trusted. The manifest names every file, and is itself part of the CID.
 *
 * An index, a directory holding only index.json, is verified the same way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { gatewayUrl } from "./ipfs/gateways.js"
import { packDirectory } from "./ipfs/car.js"
import { SnapshotError } from "./errors.js"
import { manifestMismatch } from "./write.js"

export interface Verdict {
  /** The CID the files hash to. */
  readonly derived: string
  readonly files: readonly string[]
  /** Null when no CID was given to compare with. */
  readonly matches: boolean | null
  /** For a snapshot, whether its manifest lists exactly its files. Null for an index. */
  readonly manifest: string | null
}

const isIndex = (files: readonly string[]) => files.length === 1 && files[0] === "index.json"

/** Pack `dir` and compare with `expected`, when given. */
export async function verifyDirectory(dir: string, expected?: string): Promise<Verdict> {
  const packed = await packDirectory(dir)
  const manifest = isIndex(packed.files) ? null : (manifestMismatch(dir) ?? "lists exactly the files present")
  return {
    derived: packed.cid,
    files: packed.files,
    matches: expected === undefined ? null : packed.cid === expected,
    manifest,
  }
}

async function get(fetcher: typeof fetch, url: string, path: string): Promise<Uint8Array | null> {
  let res: Response
  try {
    res = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    throw new SnapshotError(`the gateway did not answer for ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new SnapshotError(`the gateway answered HTTP ${res.status} for ${path}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Fetch every file of `cid` through `origin` into a new temporary directory, and return it.
 * A snapshot's files are the ones its manifest lists; an index is its index.json. The caller
 * removes the directory.
 */
export async function fetchSnapshot(cid: string, origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-verify-"))
  try {
    const save = (path: string, bytes: Uint8Array) => {
      // A path from the manifest is relative and stays inside the directory.
      if (path.startsWith("/") || path.split("/").includes("..")) throw new SnapshotError(`the manifest lists an unsafe path: ${path}`)
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), bytes)
    }
    const manifest = await get(fetcher, gatewayUrl(origin, cid, "manifest.json"), "manifest.json")
    if (manifest === null) {
      const index = await get(fetcher, gatewayUrl(origin, cid, "index.json"), "index.json")
      if (index === null) throw new SnapshotError(`${cid} holds neither manifest.json nor index.json`)
      save("index.json", index)
      return dir
    }
    save("manifest.json", manifest)
    let files: unknown
    try {
      files = (JSON.parse(new TextDecoder().decode(manifest)) as { files?: unknown }).files
    } catch {
      throw new SnapshotError("manifest.json is not valid JSON")
    }
    if (!Array.isArray(files) || !files.every((f) => typeof f === "string")) throw new SnapshotError("manifest.json lists no files")
    for (const path of files as string[]) {
      const bytes = await get(fetcher, gatewayUrl(origin, cid, path), path)
      if (bytes === null) throw new SnapshotError(`the manifest lists ${path}, and the gateway answered 404 for it`)
      save(path, bytes)
    }
    return dir
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}
