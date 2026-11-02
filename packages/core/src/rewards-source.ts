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
 * repository's `assets/rewards` layout under the dataset root; check that when SEF populates
 * the name. Until then a 404 from the dataset proves nothing: only the repository's 404, whose
 * layout is known, reads as "no such file".
 *
 * The browser app imports this module, so it reads no environment. A caller passes in its own
 * configured gateway, and reads the chain through the client it passes in.
 */
import {
  decodeErrorResult, decodeFunctionResult, encodeFunctionData, hexToBytes, isHex, toHex, type Hex, type PublicClient,
} from "viem"
import { mainnet } from "viem/chains"
import { namehash, packetToBytes } from "viem/ens"
import { ensResolverAbi, ensUniversalResolverAbi } from "./abis.js"
import { SEF_DATA } from "./contracts.js"

/** The ENS name SEF declares the canonical reference for reward data. */
export const SEF_REWARDS_ENS_NAME = "rewards.safenet-gov.eth"

/**
 * Public IPFS gateways, tried in this order after a configured one. Each serves path-style
 * URLs, `<gateway>/ipfs/<cid>/<path>`, with the file's own bytes, and sends
 * `access-control-allow-origin: *` on a 404 as well, so a browser sees the 404 and not a CORS
 * failure. Checked on 2026-10-08 against the Uniswap token list, a 667 kB JSON file, by CID:
 *
 * - ipfs.orbitor.dev: 200 `application/json` in 0.11 to 0.17 s, a missing path 404 in 0.06 s.
 *   ChainSafe's Orbitor gateway, behind Cloudflare: an inference from ChainSafe's own pages,
 *   about.orbitor.dev and its announcement of 2025-12-09, which names this host the global
 *   endpoint of latam, eu and apac.orbitor.dev.
 * - ipfs.filebase.io: operated by Filebase. 200 `application/json` in 1.35 to 1.41 s, a missing
 *   path 404 in 0.5 s; one request in ten hung past 25 s. Its 404 arrives as headers and then
 *   an HTTP/2 stream reset with no body: `fetch` resolves with status 404, and reading the body
 *   fails. Every attempt in this repository returns on the status before it reads a body, which
 *   both gateways need.
 *
 * The IPFS project's public-gateway-checker lists both, and still lists the retired ipfs.io and
 * dweb.link, so a listing there is not evidence that a gateway serves content.
 *
 * ipfs.io and dweb.link are retired: since 2026-09-21 both answer every path with a 429 that
 * points at https://gatewaychanges.ipfs.io, which says the public gateway no longer fetches
 * content over HTTP. Gateways that redirect to them, such as w3s.link, storacha.link and
 * nftstorage.link, are retired with them. cloudflare-ipfs.com does not resolve in DNS.
 * gateway.pinata.cloud serves JSON but took 3.5 to 8.5 s, slower than a gateway's time slice.
 */
export const ORBITOR_IPFS_GATEWAY = "https://ipfs.orbitor.dev"
export const IPFS_GATEWAYS: readonly string[] = [ORBITOR_IPFS_GATEWAY, "https://ipfs.filebase.io"]

/** How long one resolution of the ENS name is reused. SEF publishes rewards every two weeks. */
export const REWARDS_SOURCE_STALE_MS = 60 * 60 * 1000

/** How long a failed resolution is reused before the chain is read again. */
export const REWARDS_SOURCE_RETRY_MS = 60_000

/**
 * How long one read waits: the ENS lookup, a file from the repository, or a file from all the
 * gateways together. The gateways share one budget, so dead gateways delay the repository by
 * one timeout, not by one each. Within it, each gateway in turn gets the time left divided by
 * the gateways left: a hang at the first takes its share, not the second's, and time a fast
 * failure leaves unused passes to the gateways after it.
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
  /**
   * A contenthash this code cannot turn into a gateway path, such as Swarm or malformed bytes,
   * or a name whose resolver answers only offchain, through CCIP-read, which this code does not
   * follow, or reverts. `raw` is null when no contenthash was read.
   */
  | { readonly status: "unsupported"; readonly raw: Hex | null; readonly reason: string }
  /** The chain did not answer, or answered with a revert this code does not know. */
  | { readonly status: "unreadable"; readonly reason: string }

/** One place reward files are read from. `latest.json` and `proofs/` sit directly under `url`. */
export interface RewardsDataBase {
  /** No trailing slash. */
  readonly url: string
  /** `ens`: SEF's IPFS dataset through a gateway. `override`: a URL the operator configured. */
  readonly kind: "ens" | "repository" | "override"
  /** The gateway's origin, for an `ens` base. */
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
export type EnsReadClient = Pick<PublicClient, "request">

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
    // Real names carry stray whitespace: tokens.uniswap.eth held "tokens.uniswap.org " on
    // 2026-10-08, which gateways read as the name without the space.
    const text = new TextDecoder().decode(digest).trim()
    if (hashCode === IDENTITY && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text)) return { protocol: "ipns", name: text }
    return { protocol: "ipns", name: `b${base32(cid)}` }
  }
  throw new Error(`protocol 0x${protocol.toString(16)} is neither IPFS nor IPNS`)
}

/**
 * The gateways in the order to try them: a configured one first, then the public list. Only
 * the origin of a configured value counts: a path such as `/ipfs/` is dropped, because the
 * `/ipfs/<cid>` path is added here. A value that is not an http(s) URL is ignored, as is a repeat.
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
    if (!origins.includes(url.origin)) origins.push(url.origin)
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

/** The host of a URL, or the text as given when it is not an absolute URL, such as a relative override. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
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

/** The contenthash bytes the name holds, `0x` when it has none, or why there are none to read. */
type ContenthashAnswer = { readonly raw: Hex } | { readonly unsupported: string }

/**
 * The contenthash of the ENS name, read through the Universal Resolver's `resolve`, which follows
 * ENSIP-10: it finds the resolver on the name or, for a wildcard resolver, on a parent, and asks
 * it for the name. So the name's own resolver and a parent's wildcard resolver read the same way.
 *
 * Until this read, the code asked `findResolver` for the resolver and refused any found on a
 * parent, by its offset. On 2026-10-08 the name's offset was 0. On 2026-10-27, at block
 * 26,287,089, `findResolver` named one bridge resolver on the second-level name for every name,
 * at offset 8 for this one, while the registry still held the name's own resolver and `resolve`
 * returned its contenthash unchanged. Our inference: ENS moved names behind that resolver
 * between the two dates.
 *
 * The call is a plain `eth_call`, not viem's `readContract`: viem follows an `OffchainLookup`
 * revert by itself whenever the client allows CCIP-read, and neither the CLI's client nor the
 * interface's disables it. Here a revert is only decoded. `OffchainLookup` and `ResolverError`
 * become `unsupported` with the reason; `ResolverNotFound` means the name has no resolver.
 */
async function readContenthash(client: EnsReadClient): Promise<ContenthashAnswer> {
  const lookup = encodeFunctionData({
    abi: ensResolverAbi,
    functionName: "contenthash",
    args: [namehash(SEF_REWARDS_ENS_NAME)],
  })
  const data = encodeFunctionData({
    abi: ensUniversalResolverAbi,
    functionName: "resolve",
    args: [toHex(packetToBytes(SEF_REWARDS_ENS_NAME)), lookup],
  })
  let result: Hex
  try {
    result = await client.request({
      method: "eth_call",
      params: [{ to: mainnet.contracts.ensUniversalResolver.address, data }, "latest"],
    })
  } catch (error) {
    const reverted = universalResolverRevert(error)
    if (reverted) return reverted
    throw error
  }
  const [answer] = decodeFunctionResult({ abi: ensUniversalResolverAbi, functionName: "resolve", data: result })
  return { raw: decodeFunctionResult({ abi: ensResolverAbi, functionName: "contenthash", data: answer }) }
}

/** A Universal Resolver revert this code knows, read off the RPC error; undefined for anything else. */
function universalResolverRevert(error: unknown): ContenthashAnswer | undefined {
  const data = revertData(error)
  if (!data) return undefined
  let errorName: string
  try {
    errorName = decodeErrorResult({ abi: ensUniversalResolverAbi, data }).errorName
  } catch {
    return undefined
  }
  switch (errorName) {
    case "ResolverNotFound": return { raw: "0x" }
    case "OffchainLookup": return { unsupported: "the name's resolver answers only offchain, through CCIP-read, which this code does not follow" }
    case "ResolverError": return { unsupported: "the name's resolver reverted when asked for the contenthash" }
    default: return undefined
  }
}

/**
 * The revert bytes an RPC error carries. A node answers a reverted `eth_call` with the bytes in
 * the error's `data`, sometimes nested one level, and viem keeps them on the error or its cause.
 */
function revertData(error: unknown): Hex | undefined {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    const data = (e as { data?: unknown }).data
    const hex = typeof data === "object" && data !== null ? (data as { data?: unknown }).data : data
    if (typeof hex === "string" && isHex(hex) && hex.length >= 10) return hex
  }
  return undefined
}

/** What the ENS name holds on Mainnet. Never throws: a failed read is the `unreadable` state. */
export async function readRewardsEnsState(
  client: EnsReadClient,
  options: { readonly timeoutMs?: number } = {},
): Promise<RewardsEnsState> {
  let answer: ContenthashAnswer
  try {
    answer = await within(options.timeoutMs ?? REWARDS_FETCH_TIMEOUT_MS, undefined, () => readContenthash(client))
  } catch (error) {
    return { status: "unreadable", reason: failureReason(error) }
  }
  if ("unsupported" in answer) return { status: "unsupported", raw: null, reason: answer.unsupported }
  const { raw } = answer
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

/** What one base answered, in the order the bases were tried. */
export interface RewardsAttempt {
  readonly base: RewardsDataBase
  /** `skipped`: the gateways' shared time ran out before this one was asked. */
  readonly outcome: "found" | "not found" | "timeout" | "skipped" | "error"
  /** What `attempt` threw, for outcome `error`. */
  readonly error?: unknown
}

export function describeAttempt(a: RewardsAttempt): string {
  const host = hostOf(a.base.url)
  switch (a.outcome) {
    case "found": return `${host}: found`
    case "not found": return `${host}: not found`
    case "timeout": return `${host}: no answer in time`
    case "skipped": return `${host}: skipped, the gateways' time was spent`
    case "error": return `${host}: ${failureReason(a.error)}`
  }
}

/**
 * What the IPFS dataset's gateways said, when a read did not end there. `not found` when every
 * gateway asked answered 404, which points at the dataset's layout rather than at a gateway;
 * `unanswered` otherwise. Undefined when no gateway was in the list.
 */
export function datasetMiss(tried: readonly RewardsAttempt[]): "not found" | "unanswered" | undefined {
  const gateways = tried.filter((a) => a.base.kind === "ens")
  if (gateways.length === 0) return undefined
  return gateways.every((a) => a.outcome === "not found") ? "not found" : "unanswered"
}

/** No base had the file, and none whose layout is known answered 404. `attempts` holds one entry per base. */
export class RewardsReadError extends Error {
  readonly path: string
  readonly attempts: readonly RewardsAttempt[]

  constructor(path: string, attempts: readonly RewardsAttempt[]) {
    super(`No source answered for ${path}: ${attempts.map(describeAttempt).join("; ")}`)
    this.name = "RewardsReadError"
    this.path = path
    this.attempts = attempts
  }
}

export interface RewardsRead<T> {
  /** Null when a base whose layout is known answered that the file does not exist. */
  readonly value: T | null
  /** The base that had the file, or, with none, the base whose 404 settled it. */
  readonly base: RewardsDataBase
  readonly url: string
  /** Every base, asked or skipped, in order, ending with `base`. */
  readonly tried: readonly RewardsAttempt[]
}

/**
 * Reads one file from the first base that answers.
 *
 * `attempt` fetches one URL and returns the parsed file, null when the server says it does not
 * exist, or throws. Any failure falls through to the next base: an error, a timeout, a file of
 * the wrong shape, and also a 404 from the IPFS dataset, whose layout is unconfirmed, so a
 * wrong path must not read as "no rewards".
 *
 * With no file anywhere, the answer is null when the repository, or a configured override,
 * answered 404: their layout is known, so the 404 means the file does not exist, whatever the
 * gateways did. Otherwise it throws a `RewardsReadError`. A gateway that is rate-limited or down
 * therefore never turns "no rewards" into "could not load".
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
  const tried: RewardsAttempt[] = []
  const gatewaysUntil = Date.now() + timeoutMs
  let gatewaysLeft = bases.filter((b) => b.kind === "ens").length
  for (const base of bases) {
    signal?.throwIfAborted()
    const budget = base.kind === "ens" ? (gatewaysUntil - Date.now()) / gatewaysLeft-- : timeoutMs
    // The slices never run out by themselves: only a gateway whose timer fired late, past the
    // gatewaysUntil instant, leaves nothing for the gateways after it.
    if (budget <= 0) {
      tried.push({ base, outcome: "skipped" })
      continue
    }
    const url = `${base.url}/${path}`
    try {
      const value = await within(budget, signal, (s) => attempt(url, s))
      if (value !== null) {
        tried.push({ base, outcome: "found" })
        return { value, base, url, tried }
      }
      tried.push({ base, outcome: "not found" })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      tried.push(error instanceof Timeout ? { base, outcome: "timeout" } : { base, outcome: "error", error })
    }
  }
  const settled = tried.find((a) => a.base.kind !== "ens" && a.outcome === "not found")
  if (settled) return { value: null, base: settled.base, url: `${settled.base.url}/${path}`, tried }
  throw new RewardsReadError(path, tried)
}
