/**
 * The inputs of a parity run: SEF's files at the commit that last wrote them, our subgraph at
 * a block, and the block at an instant. Node only: this reads the environment and runs `gh`,
 * which is why it sits behind `@cobuilders/safenet-core/parity` and not the main export the
 * browser app imports.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { createPublicClient, fallback, http } from "viem"
import { CHAINS, rpcUrls, type ChainKey } from "../chains.js"
import { CONTRACTS, SEF_DATA } from "../contracts.js"
import { blockAtTimestamp } from "./blocks.js"
import { parseLastCommit, type SefCommit } from "./compare.js"

/** RPC endpoints carry keys in their paths. Every message a run prints goes through this. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s"'`)]+/g, "<redacted-url>")
}

/**
 * A GitHub token, if one is available, and where it came from. Never printed.
 *
 * Unauthenticated, the API allows 60 requests an hour per IP, shared with every other script
 * on the machine. `gh auth token` is the third source because scripts/setup.sh already
 * requires the gh CLI. `||`, not `??`: an empty `GITHUB_TOKEN=` line means unset.
 */
export function githubToken(): { token?: string; source: string } {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (env) return { token: env, source: "GITHUB_TOKEN" }
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (t) return { token: t, source: "gh auth token" }
  } catch {
    // No gh, or not signed in: fall through to an unauthenticated request.
  }
  return { source: "none: unauthenticated, 60 requests an hour per IP" }
}

/** The last commit that wrote one of SEF's files. `url` is one of the `*Commits` in SEF_DATA. */
export async function lastSefCommit(url: string, token?: string): Promise<SefCommit> {
  const r = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  const body: unknown = await r.json().catch(() => null)
  return parseLastCommit(body)
}

/**
 * One file under SEF's `assets/` at a commit. The raw host serves a commit's tree immutably and
 * does not count against the API limit; reading `main` instead could serve a file one cron run
 * newer or older than the commit, because the API and the raw CDN cache separately.
 */
export async function sefAsset<T>(sha: string, file: string): Promise<T> {
  const r = await fetch(`${SEF_DATA.assetsAtCommit(sha)}/${file}`)
  if (!r.ok) throw new Error(`SEF's ${file} at ${sha.slice(0, 7)} answered HTTP ${r.status}`)
  return (await r.json()) as T
}

/**
 * The subgraph a run reads: `SUBGRAPH_URL_MAINNET` or `SUBGRAPH_URL_GNOSIS`, else the local
 * graph-node that `pnpm graph:up` starts. One variable per chain, because `pnpm test:parity`
 * runs both packages from one environment.
 */
export function subgraphEndpoint(chain: ChainKey): string {
  const set = chain === "mainnet" ? process.env.SUBGRAPH_URL_MAINNET : process.env.SUBGRAPH_URL_GNOSIS
  return set || `http://localhost:${process.env.GRAPH_NODE_PORT ?? "8000"}/subgraphs/name/safenet/${chain}`
}

/**
 * One GraphQL query. Studio answers an unknown slug or version with HTTP 200 and
 * {"message":"Not found"}, and a gateway failure with an HTML page; both throw a sentence
 * that names the variable to check and leaves the URL out.
 */
export async function querySubgraph<T>(chain: ChainKey, endpoint: string, query: string): Promise<T> {
  const variable = chain === "mainnet" ? "SUBGRAPH_URL_MAINNET" : "SUBGRAPH_URL_GNOSIS"
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`the ${chain} subgraph answered HTTP ${r.status}; check ${variable}`)
  const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[]; message?: string }
  if (j.errors) throw new Error(`the ${chain} subgraph: ${j.errors.map((e) => e.message).join("; ")}`)
  if (!j.data) throw new Error(`the ${chain} subgraph answered ${j.message ? `"${j.message}"` : "no data"}; check ${variable}`)
  return j.data
}

/**
 * The first block a pruned deployment still answers for, read from graph-node's refusal of an
 * older `block: { number }`, or undefined when the message is something else. Studio keeps
 * about 1,000 blocks of history (`historyBlocks` in its indexing status on 2026-10-05), though
 * our manifests set no `indexerHints`, which graph-node documents as keeping all of it.
 */
export function prunedFrom(message: string): bigint | undefined {
  const m = /only has data starting at block number (\d+)/.exec(message)
  return m ? BigInt(m[1]!) : undefined
}

/** A reader for block numbers and timestamps on one chain, through the same RPC order as the rest. */
export function chainReader(chain: ChainKey) {
  const client = createPublicClient({ chain: CHAINS[chain], transport: fallback(rpcUrls(chain).map((u) => http(u))) })
  const floor = chain === "mainnet" ? CONTRACTS.staking.deployBlock : CONTRACTS.consensus.deployBlock
  return {
    head: () => client.getBlockNumber(),
    /** The block at an instant on this chain. See blockAtTimestamp for `side`. */
    blockAt: async (at: Date, side: "first" | "last", head: bigint) =>
      blockAtTimestamp({
        timestampOf: async (n) => (await client.getBlock({ blockNumber: n })).timestamp,
        lo: floor,
        hi: head,
        target: BigInt(Math.floor(at.getTime() / 1000)),
        side,
      }),
  }
}

/** Appends Markdown to the GitHub Actions job summary. Does nothing outside Actions. */
export function appendSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, markdown.endsWith("\n") ? markdown : markdown + "\n")
}
