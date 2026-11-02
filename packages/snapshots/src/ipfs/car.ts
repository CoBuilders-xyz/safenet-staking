/**
 * Pack a directory into a CAR whose root CID anyone can rebuild.
 *
 * The interface's release and the daily snapshots both pack through here, so a CID means the
 * same thing for both. The settings are ipfs-car 3.1.0's defaults, which are also the
 * web3.storage defaults: CIDv1, raw leaves, 1 MiB fixed-size chunks, balanced layout 1024 links
 * wide, UnixFS directories sharded only above 1000 entries, no mtime and no mode. The CAR is
 * what gets pinned, so the provider stores this DAG as built here and does not re-chunk the
 * files. `npx ipfs-car@3.1.0 pack <dir>` on the same directory gives the same CID.
 */
import { createReadStream, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Readable } from "node:stream"
import * as UnixFS from "@ipld/unixfs"
import { withMaxChunkSize } from "@ipld/unixfs/file/chunker/fixed"
import { withWidth } from "@ipld/unixfs/file/layout/balanced"
import { CAREncoderStream, createDirectoryEncoderStream, type Block, type FileLike } from "ipfs-car"
import * as raw from "multiformats/codecs/raw"

/** ipfs-car 3.1.0's defaults, written out so an ipfs-car upgrade cannot change the CID silently. */
function settings() {
  return UnixFS.configure({
    fileChunkEncoder: raw,
    smallFileEncoder: raw,
    chunker: withMaxChunkSize(1024 * 1024),
    fileLayout: withWidth(1024),
  })
}

/** Byte order, not locale order, so every machine walks the files the same way. */
export const byteOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Every file under `dir`, relative to it, with `/`, in byte order. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort(byteOrder)
}

/** A packing that cannot be rebuilt the same way elsewhere. The message names the files. */
export class PackError extends Error {}

export interface Packed {
  /** The root CID, as a string. */
  readonly cid: string
  readonly car: Uint8Array
  /** The files packed, relative to the directory, in byte order. */
  readonly files: readonly string[]
  readonly blocks: number
}

/**
 * Pack every file under `dir`. Refuses dot-files: ipfs-car's command line skips them by default,
 * so a DAG holding one could not be rebuilt with it. Refuses an empty directory.
 */
export async function packDirectory(dir: string): Promise<Packed> {
  const paths = listFiles(dir)
  const hidden = paths.filter((p) => p.split("/").some((part) => part.startsWith(".")))
  if (hidden.length) throw new PackError(`dot-files, which the CID check would not cover: ${hidden.join(", ")}`)
  if (paths.length === 0) throw new PackError("no file to pack")

  const files: FileLike[] = paths.map((name) => ({
    name,
    stream: () => Readable.toWeb(createReadStream(join(dir, name))) as ReadableStream,
  }))

  // Collect the blocks first: the root is the last block, and the CAR header names the root.
  const blocks: Block[] = []
  await createDirectoryEncoderStream(files, settings()).pipeTo(
    new WritableStream<Block>({ write: (block) => void blocks.push(block) }),
  )
  const root = blocks.at(-1)?.cid
  if (!root) throw new PackError("packing produced no block")

  const chunks: Uint8Array[] = []
  await new ReadableStream<Block>({
    start(controller) {
      for (const block of blocks) controller.enqueue(block)
      controller.close()
    },
  })
    .pipeThrough(new CAREncoderStream([root]))
    .pipeTo(new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) }))

  return { cid: root.toString(), car: Buffer.concat(chunks), files: paths, blocks: blocks.length }
}
