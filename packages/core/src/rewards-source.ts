/**
 * Where SEF's reward data is read from, and in what order.
 *
 * From the first Safenet Aegis distribution, SEF declares the ENS name `rewards.safenet-gov.eth`
 * the canonical reference for reward data. Its contenthash points at an IPFS dataset with the
 * cumulative Beta and Aegis rewards: `latest.json` and the proof files. The repository
 * `safe-fndn/safenet-data` stays as a temporary mirror, and is not canonical.
 *
 * On 2026-10-07 the name had a resolver on Mainnet and an empty contenthash. So every reader
 * resolves the name, reads the dataset when the contenthash is set, and falls back to the
 * repository while it is empty or cannot be read. Nothing needs a deploy when SEF populates it.
 *
 * The dataset's layout is not published yet. The paths in sef.ts assume it repeats the
 * repository's layout under the dataset root; check that when SEF populates the name.
 *
 * The browser app imports this module, so it reads no environment. A caller passes in its own
 * configured gateway, and reads the chain through the client it passes in.
 */
import { hexToBytes, isHex, toHex, zeroAddress, type Hex, type PublicClient } from "viem"
import { mainnet } from "viem/chains"
import { namehash, packetToBytes } from "viem/ens"
import { ensResolverAbi, ensUniversalResolverAbi } from "./abis.js"
import { SEF_DATA } from "./contracts.js"

/** The ENS name SEF declares the canonical reference for reward data. */
export const SEF_REWARDS_ENS_NAME = "rewards.safenet-gov.eth"

/**
 * Public IPFS gateways, tried in this order after a configured one. Each serves path-style
 * URLs, `<gateway>/ipfs/<cid>/<path>`. cloudflare-ipfs.com did not resolve in DNS on
 * 2026-10-07, so it fails at once and costs the fallback nothing.
 */
export const IPFS_GATEWAYS: readonly string[] = ["https://ipfs.io", "https://dweb.link", "https://cloudflare-ipfs.com"]

/** How long one resolution of the ENS name is reused. SEF publishes rewards every two weeks. */
export const REWARDS_SOURCE_STALE_MS = 60 * 60 * 1000

/**
 * How long one read waits: the ENS lookup, a file from the repository, or a file from all the
 * gateways together. The gateways share one budget, so dead gateways delay the repository by
 * one timeout, not by one each.
 */
export const REWARDS_FETCH_TIMEOUT_MS = 10_000

/** What a contenthash points at, in the form a gateway path takes. */
export type RewardsContenthash =
  | { readonly protocol: "ipfs"; readonly cid: string }
  | { readonly protocol: "ipns"; readonly name: string }

/** What the ENS name held when it was read. Only `set` adds the dataset to the bases. */
export type RewardsEnsState =
  | { readonly status: "set"; readonly contenthash: RewardsContenthash; readonly raw: Hex }
  /** No resolver, or a resolver with an empty contenthash: SEF has not populated the name. */
  | { readonly status: "empty" }
  /** A contenthash this code cannot turn into a gateway path, such as Swarm or malformed bytes. */
  | { readonly status: "unsupported"; readonly raw: Hex; readonly reason: string }
  /** The chain did not answer. */
  | { readonly status: "unreadable"; readonly reason: string }

/** One place reward files are read from. `latest.json` and `proofs/` sit directly under `url`. */
export interface RewardsDataBase {
  /** No trailing slash. */
  readonly url: string
  /** `ens`: SEF's IPFS dataset through a gateway. `override`: a URL the operator configured. */
  readonly kind: "ens" | "repository" | "override"
  /** The gateway origin, for an `ens` base. */
  readonly gateway?: string
}

export interface RewardsSource {
  readonly ens: RewardsEnsState
  /** In the order to try them. Never empty: the repository is always last. */
  readonly bases: readonly RewardsDataBase[]
}

/** The repository mirror, the last base in every list. */
export const REPOSITORY_REWARDS_BASE: RewardsDataBase = { url: SEF_DATA.rewardsProofBase, kind: "repository" }

/** The one client method resolution needs, so a test can pass a stub. */
export type EnsReadClient = Pick<PublicClient, "readContract">

// ENSIP-7 protocol codes, and the multiformats codes a CID carries.
const IPFS_NS = 0xe3
const IPNS_NS = 0xe5
const CID_V1 = 0x01
const DAG_PB = 0x70
const SHA2_256 = 0x12
const IDENTITY = 0x00

/** Unsigned LEB128, as multiformats writes every code and length. */
function readVarint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0
  for (let shift = 0, i = at; i < bytes.length && shift < 28; shift += 7, i++) {
    const byte = bytes[i]!
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [value, i + 1]
  }
  throw new Error("a varint runs past the end of the contenthash")
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567"

/** RFC 4648 base32, lower case, no padding: multibase `b`, the form gateways print. */
function base32(bytes: Uint8Array): string {
  let out = ""
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** A CID's codec and multihash, after checking every length adds up to the end of the bytes. */
function parseCid(bytes: Uint8Array): { cid: Uint8Array; codec: number; hashCode: number; digest: Uint8Array } {
  // A bare sha2-256 multihash is a CIDv0. Rewrapped as CIDv1 dag-pb, it names the same content.
  const cid = bytes[0] === SHA2_256 && bytes[1] === 32 && bytes.length === 34
    ? Uint8Array.of(CID_V1, DAG_PB, ...bytes)
    : bytes
  const [version, afterVersion] = readVarint(cid, 0)
  if (version !== CID_V1) throw new Error(`CID version ${version} is not 1`)
  const [codec, afterCodec] = readVarint(cid, afterVersion)
  const [hashCode, afterHash] = readVarint(cid, afterCodec)
  const [length, start] = readVarint(cid, afterHash)
  if (start + length !== cid.length) throw new Error("the multihash length does not match the bytes")
  return { cid, codec, hashCode, digest: cid.subarray(start) }
}

/**
 * An ENSIP-7 contenthash as a gateway path segment. Null when it is empty. Throws for a
 * protocol other than IPFS and IPNS, and for bytes that are not a well-formed CID.
 */
export function decodeContenthash(raw: Hex): RewardsContenthash | null {
  if (!isHex(raw, { strict: true }) || raw.length % 2 !== 0) throw new Error("the contenthash is not hex bytes")
  const bytes = hexToBytes(raw)
  if (bytes.length === 0) return null
  const [protocol, start] = readVarint(bytes, 0)
  const rest = bytes.subarray(start)
  if (protocol === IPFS_NS) return { protocol: "ipfs", cid: `b${base32(parseCid(rest).cid)}` }
  if (protocol === IPNS_NS) {
    const { cid, hashCode, digest } = parseCid(rest)
    // A DNSLink name is written as an identity hash over its text; a key is a protobuf there.
    const text = new TextDecoder().decode(digest)
    if (hashCode === IDENTITY && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text)) return { protocol: "ipns", name: text }
    return { protocol: "ipns", name: `b${base32(cid)}` }
  }
  throw new Error(`protocol 0x${protocol.toString(16)} is neither IPFS nor IPNS`)
}

/**
 * The gateways in the order to try them: a configured one first, then the public list. A
 * configured value that is not an http(s) URL is ignored, as is a repeat.
 */
export function ipfsGateways(configured?: string): string[] {
  const origins: string[] = []
  for (const candidate of [configured, ...IPFS_GATEWAYS]) {
    if (!candidate) continue
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      continue
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue
    const origin = `${url.origin}${url.pathname}`.replace(/\/+$/, "")
    if (!origins.includes(origin)) origins.push(origin)
  }
  return origins
}

/** The dataset's root through each gateway, in order. */
export function datasetBases(contenthash: RewardsContenthash, gateways: readonly string[]): RewardsDataBase[] {
  const path = contenthash.protocol === "ipfs" ? `ipfs/${contenthash.cid}` : `ipns/${contenthash.name}`
  return gateways.map((gateway) => ({ url: `${gateway}/${path}`, kind: "ens", gateway }))
}

/** The bases to try for an ENS state: the dataset through each gateway when set, then the repository. */
export function rewardsDataBases(ens: RewardsEnsState, gateway?: string): RewardsDataBase[] {
  if (ens.status !== "set") return [REPOSITORY_REWARDS_BASE]
  return [...datasetBases(ens.contenthash, ipfsGateways(gateway)), REPOSITORY_REWARDS_BASE]
}

/**
 * One line saying why something failed, with every URL cut to its host: an RPC URL can carry
 * a key in its path or its query.
 */
export function failureReason(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown } | null | undefined
  const text =
    typeof e?.shortMessage === "string" && e.shortMessage
      ? e.shortMessage
      : typeof e?.message === "string" ? e.message : String(error)
  return text.split("\n")[0]!.replace(/\bhttps?:\/\/[^\s"'<>)]+/g, (u) => {
    try {
      return new URL(u).host
    } catch {
      return "<URL>"
    }
  })
}

class Timeout extends Error {
  constructor(ms: number) {
    super(`no answer within ${ms} ms`)
    this.name = "Timeout"
  }
}

/** Runs `run` with a signal that aborts after `ms` or with `outer`, and stops waiting at once either way. */
async function within<T>(ms: number, outer: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(outer?.reason)
  outer?.addEventListener("abort", onAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeout = new Timeout(ms)
      controller.abort(timeout)
      reject(timeout)
    }, ms)
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
  })
  try {
    return await Promise.race([run(controller.signal), stop])
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener("abort", onAbort)
  }
}

/** The contenthash bytes of the ENS name, `0x` when it has no resolver. */
async function readContenthash(client: EnsReadClient): Promise<Hex> {
  // The same call viem's getEnsResolver makes, through `readContract`, so a stub can answer it.
  const [resolver] = await client.readContract({
    address: mainnet.contracts.ensUniversalResolver.address,
    abi: ensUniversalResolverAbi,
    functionName: "findResolver",
    args: [toHex(packetToBytes(SEF_REWARDS_ENS_NAME))],
  })
  if (resolver.toLowerCase() === zeroAddress) return "0x"
  return client.readContract({
    address: resolver,
    abi: ensResolverAbi,
    functionName: "contenthash",
    args: [namehash(SEF_REWARDS_ENS_NAME)],
  })
}

/** What the ENS name holds on Mainnet. Never throws: a failed read is the `unreadable` state. */
export async function readRewardsEnsState(
  client: EnsReadClient,
  options: { readonly timeoutMs?: number } = {},
): Promise<RewardsEnsState> {
  let raw: Hex
  try {
    raw = await within(options.timeoutMs ?? REWARDS_FETCH_TIMEOUT_MS, undefined, () => readContenthash(client))
  } catch (error) {
    return { status: "unreadable", reason: failureReason(error) }
  }
  try {
    const contenthash = decodeContenthash(raw)
    return contenthash ? { status: "set", contenthash, raw } : { status: "empty" }
  } catch (error) {
    return { status: "unsupported", raw, reason: failureReason(error) }
  }
}

/** Resolves the ENS name and lists the bases to try: the dataset first when set, then the repository. */
export async function resolveRewardsSource(
  client: EnsReadClient,
  options: { readonly gateway?: string | undefined; readonly timeoutMs?: number } = {},
): Promise<RewardsSource> {
  const ens = await readRewardsEnsState(client, options)
  return { ens, bases: rewardsDataBases(ens, options.gateway) }
}

/** Why one base gave no file. */
export interface RewardsAttemptFailure {
  readonly base: RewardsDataBase
  readonly kind: "not found" | "timeout" | "skipped" | "error"
  /** What `attempt` threw, for kind `error`. */
  readonly error?: unknown
}

export function describeFailure(f: RewardsAttemptFailure): string {
  const host = new URL(f.base.url).host
  switch (f.kind) {
    case "not found": return `${host}: not found`
    case "timeout": return `${host}: no answer in time`
    case "skipped": return `${host}: skipped, the gateways' time was spent`
    case "error": return `${host}: ${failureReason(f.error)}`
  }
}

/** Every base failed. `failures` holds one entry per base, in order. */
export class RewardsReadError extends Error {
  readonly path: string
  readonly failures: readonly RewardsAttemptFailure[]

  constructor(path: string, failures: readonly RewardsAttemptFailure[]) {
    super(`No source answered for ${path}: ${failures.map(describeFailure).join("; ")}`)
    this.name = "RewardsReadError"
    this.path = path
    this.failures = failures
  }
}

export interface RewardsRead<T> {
  /** Null when every base answered that the file does not exist. */
  readonly value: T | null
  /** The base that answered, or the first base when none had the file. */
  readonly base: RewardsDataBase
  readonly url: string
}

/**
 * Reads one file from the first base that answers.
 *
 * `attempt` fetches one URL and returns the parsed file, null when the server says it does not
 * exist, or throws. Any failure falls through to the next base: an error, a timeout, a file of
 * the wrong shape, and also a 404, because the dataset's layout is unconfirmed and a wrong path
 * must not read as "no rewards". The answer is null only when every base answered 404;
 * otherwise, with no file, it throws a `RewardsReadError`.
 */
export async function readRewardsFile<T>(options: {
  readonly bases: readonly RewardsDataBase[]
  readonly path: string
  readonly attempt: (url: string, signal: AbortSignal) => Promise<T | null>
  readonly timeoutMs?: number
  /** Aborts the whole read, such as when a query is cancelled. */
  readonly signal?: AbortSignal
}): Promise<RewardsRead<T>> {
  const { bases, path, attempt, signal } = options
  const timeoutMs = options.timeoutMs ?? REWARDS_FETCH_TIMEOUT_MS
  if (bases.length === 0) throw new RewardsReadError(path, [])
  const failures: RewardsAttemptFailure[] = []
  const gatewaysUntil = Date.now() + timeoutMs
  for (const base of bases) {
    signal?.throwIfAborted()
    const budget = base.kind === "ens" ? gatewaysUntil - Date.now() : timeoutMs
    if (budget <= 0) {
      failures.push({ base, kind: "skipped" })
      continue
    }
    const url = `${base.url}/${path}`
    try {
      const value = await within(budget, signal, (s) => attempt(url, s))
      if (value !== null) return { value, base, url }
      failures.push({ base, kind: "not found" })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      failures.push(error instanceof Timeout ? { base, kind: "timeout" } : { base, kind: "error", error })
    }
  }
  if (failures.every((f) => f.kind === "not found")) {
    return { value: null, base: bases[0]!, url: `${bases[0]!.url}/${path}` }
  }
  throw new RewardsReadError(path, failures)
}
