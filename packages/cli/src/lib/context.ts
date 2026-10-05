/**
 * What every operation needs: a Mainnet client and a way to read SEF's files.
 *
 * Passed in rather than created inside each operation, so tests and the MCP server can supply
 * their own, and so one command makes one client.
 */
import { createPublicClient, fallback, http, type PublicClient } from "viem"
import { CHAINS, rpcUrls } from "@cobuilders/safenet-core"

export interface Context {
  readonly client: PublicClient
  readonly fetch: typeof fetch
  /** Raises the GitHub API limit from 60 requests an hour per IP. Never printed. */
  readonly githubToken?: string | undefined
  /** Pause before each retry of a refused log range, times the attempt. Tests set 0. */
  readonly retryDelayMs?: number
}

export interface ContextOptions {
  /** Overrides MAINNET_RPC_URL and the public list. */
  readonly rpcUrl?: string | undefined
  readonly githubToken?: string | undefined
}

/**
 * The endpoints in the order they are tried: an explicit URL alone, else what core's
 * rpcUrls() gives, which is MAINNET_RPC_URL first and then the public list.
 */
export function rpcEndpoints(rpcUrl?: string): readonly string[] {
  return rpcUrl ? [rpcUrl] : rpcUrls("mainnet")
}

/** The host of each endpoint. The path and the query can hold a key, so they are dropped. */
export function rpcHosts(urls: readonly string[]): string[] {
  return urls.map((u) => {
    try {
      return new URL(u).host
    } catch {
      return "<unparseable URL>"
    }
  })
}

export function createContext(options: ContextOptions = {}): Context {
  const client = createPublicClient({
    chain: CHAINS.mainnet,
    transport: fallback(rpcEndpoints(options.rpcUrl).map((url) => http(url, { retryCount: 2 }))),
    batch: { multicall: true },
  }) as PublicClient
  return { client, fetch: globalThis.fetch, githubToken: options.githubToken }
}
