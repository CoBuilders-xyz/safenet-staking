/**
 * A CLI library context whose every read describes one instant: the chain at one block, and
 * each of SEF's files at the commit that last wrote it.
 *
 * The CLI's operations read the head themselves, `getBlockNumber()`, and SEF's files from
 * `main`. Run one after another, two operations could describe two blocks or two publishes. So
 * the snapshot hands them a context that answers the head with the pinned block, adds the
 * pinned block to any contract read that names none, refuses a log scan past it, and rewrites
 * a read of SEF's `main` to the pinned commit. Each URL is fetched once and answered from
 * memory after that, so every operation sees the same bytes, and the snapshot copies those
 * bytes as published.
 *
 * A read this file does not pin throws, rather than read the head unnoticed.
 */
import type { Context } from "@cobuilders/safenet-cli/lib"
import { SEF_DATA } from "@cobuilders/safenet-core"
import type { PublicClient } from "viem"
import { SnapshotError } from "./errors.js"

/** One of SEF's files under `assets/`, pinned to the commit that last wrote it. */
export interface SefPin {
  /** Relative to `assets/`, such as `validator-info.json` or `rewards/latest.json`. */
  readonly path: string
  readonly commit: string
  readonly publishedAt: Date
}

/** SEF's `main`, the base every unpinned read of SEF's files starts with. */
const MAIN_ASSETS = `${SEF_DATA.assetsAtCommit("main")}/`

/** The commits API URL for each pinned file, answered with the pin, never asked again. */
const COMMITS_URL: Readonly<Record<string, string>> = {
  [SEF_DATA.validatorInfoCommits]: "validator-info.json",
  [SEF_DATA.networkInfoCommits]: "network-info.json",
  [SEF_DATA.rewardsLatestCommits]: "rewards/latest.json",
}

/** The client methods the CLI's reads use. Any other one throws. */
const PINNED_METHODS = new Set(["getBlockNumber", "getBlock", "readContract", "getLogs"])

type Args = Record<string, unknown> | undefined

/** The client, with every read held at `block`. */
export function pinClient(client: PublicClient, block: bigint): PublicClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver)
      if (typeof value !== "function" || typeof prop !== "string") return value
      if (!PINNED_METHODS.has(prop)) {
        // viem's own plumbing, such as `request` and `extend`, stays reachable for viem; the
        // reads the CLI might grow into are refused by name.
        if (/^(get|read|call|multicall|simulate|estimate)/.test(prop)) {
          return () => {
            throw new SnapshotError(`the snapshot pins every read to block ${block}, and ${prop} is not pinned`)
          }
        }
        return value.bind(target)
      }
      return (args: Args) => {
        const a = args ?? {}
        if (prop === "getBlockNumber") return Promise.resolve(block)
        if ("blockTag" in a && a.blockTag !== undefined) {
          throw new SnapshotError(`${prop} asked for the ${String(a.blockTag)} block; the snapshot pins block ${block}`)
        }
        if (prop === "getBlock" || prop === "readContract") {
          if (a.blockHash !== undefined) return (value as (x: Args) => unknown).call(target, a)
          const at = a.blockNumber as bigint | undefined
          if (at !== undefined && at > block) {
            throw new SnapshotError(`${prop} asked for block ${at}, after the pinned block ${block}`)
          }
          return (value as (x: Args) => unknown).call(target, { ...a, blockNumber: at ?? block })
        }
        // getLogs: a bounded range that ends at or before the pin.
        const to = a.toBlock
        if (typeof to !== "bigint" || to > block) {
          throw new SnapshotError(`a log scan to ${String(to)} reaches past the pinned block ${block}`)
        }
        return (value as (x: Args) => unknown).call(target, a)
      }
    },
  })
}

interface Stored {
  readonly status: number
  readonly contentType: string | null
  readonly body: Uint8Array
}

export interface PinnedFetch {
  readonly fetch: typeof fetch
  /** The bytes of one pinned SEF file, fetched once, as SEF published them at its commit. */
  readonly sefFile: (path: string) => Promise<Uint8Array>
}

/**
 * A `fetch` that reads SEF's `main` at the pinned commits and remembers every answer.
 * `base` is the real fetch.
 */
export function pinFetch(base: typeof fetch, pins: readonly SefPin[]): PinnedFetch {
  const byPath = new Map(pins.map((p) => [p.path, p]))
  const memory = new Map<string, Promise<Stored>>()

  const load = (url: string, init?: RequestInit): Promise<Stored> => {
    let stored = memory.get(url)
    if (!stored) {
      stored = (async () => {
        const res = await base(url, init)
        return { status: res.status, contentType: res.headers.get("content-type"), body: new Uint8Array(await res.arrayBuffer()) }
      })()
      // A failed request is not remembered, so the caller's own retry reaches the network.
      stored.catch(() => memory.delete(url))
      memory.set(url, stored)
    }
    return stored
  }

  const resolve = (url: string): string => {
    if (!url.startsWith(MAIN_ASSETS)) return url
    const path = url.slice(MAIN_ASSETS.length)
    const pin = byPath.get(path)
    if (!pin) throw new SnapshotError(`SEF's ${path} is read from main, and the snapshot pinned no commit for it`)
    return `${SEF_DATA.assetsAtCommit(pin.commit)}/${path}`
  }

  const pinnedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const committed = COMMITS_URL[url]
    if (committed !== undefined) {
      const pin = byPath.get(committed)
      if (!pin) throw new SnapshotError(`the snapshot pinned no commit for SEF's ${committed}`)
      // The shape of GitHub's commits API, as parseLastCommit in core and the CLI read it.
      const body = [{ sha: pin.commit, commit: { committer: { date: pin.publishedAt.toISOString() } } }]
      return Response.json(body)
    }
    const stored = await load(resolve(url), init)
    return new Response(stored.body.slice(), {
      status: stored.status,
      headers: stored.contentType ? { "content-type": stored.contentType } : {},
    })
  }) as typeof fetch

  const sefFile = async (path: string): Promise<Uint8Array> => {
    const stored = await load(resolve(`${MAIN_ASSETS}${path}`))
    if (stored.status !== 200) throw new SnapshotError(`SEF's ${path} at its commit answered HTTP ${stored.status}`)
    return stored.body
  }

  return { fetch: pinnedFetch, sefFile }
}

/** `base` with its client held at `block` and its fetch held at the pins. */
export function pinContext(base: Context, block: bigint, fetchPins: PinnedFetch): Context {
  return { ...base, client: pinClient(base.client, block), fetch: fetchPins.fetch }
}
