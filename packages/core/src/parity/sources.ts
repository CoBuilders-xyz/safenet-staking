/**
 * The inputs of a parity run: SEF's files at the commit that last wrote them, our subgraph at
 * a block, and the block at an instant. Node only: this reads the environment and runs `gh`,
 * which is why it sits behind `@cobuilders/safenet-core/parity` and not the main export the
 * browser app imports.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createPublicClient, fallback, http } from "viem"
import { CHAINS, rpcUrls, type ChainKey } from "../chains.js"
import { CONTRACTS, SEF_DATA } from "../contracts.js"
import { DEFAULT_GRAPH_NODE_PORT, SUBGRAPH_ENDPOINTS, isLocalSubgraphUrl, localSubgraphUrl } from "../subgraphs.js"
import { blockAtTimestamp } from "./blocks.js"
import { parseLastCommit, type ParityState, type SefCommit } from "./compare.js"

/** RPC endpoints carry keys in their paths. Every message a run prints goes through this. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/[^\s"'`)]+/g, "<redacted-url>")
}

/** The four kinds of endpoint a run reads. Each fails for its own reason. */
export type EndpointFamily = "github" | "sef" | "rpc" | "subgraph"

/**
 * The error for an endpoint that did not answer at all, such as Node's bare `fetch failed`.
 * It names which endpoint and which variable to check, and leaves every URL out.
 */
export function unreachable(family: EndpointFamily, chain: ChainKey, cause: unknown): Error {
  const err = cause as { shortMessage?: unknown; message?: unknown; cause?: { message?: unknown } } | null
  // Node's fetch hides the reason, such as ECONNREFUSED, in `cause`; viem's first line is
  // `shortMessage`.
  const why = [err?.shortMessage, err?.cause?.message, err?.message].find((m) => typeof m === "string") as string | undefined
  const rpcVariable = chain === "mainnet" ? "MAINNET_RPC_URL" : "GNOSIS_RPC_URL"
  const [what, hint] = {
    github: ["the GitHub API", "the network, and GITHUB_TOKEN when it is set"],
    sef: ["SEF's files on raw.githubusercontent.com", "the network"],
    rpc: [`the ${chain} RPC`, `${rpcVariable}; when it is unset, the public endpoints in packages/core are used`],
    subgraph: [
      `the ${chain} subgraph`,
      `${chain === "mainnet" ? "SUBGRAPH_URL_MAINNET" : "SUBGRAPH_URL_GNOSIS"}; when it is unset, ` +
        "the default in packages/core is used: the deployed subgraph, or the local graph-node on GRAPH_NODE_PORT",
    ],
  }[family]
  return new Error(`could not reach ${what} (${redact((why ?? "no reason given").split("\n")[0]!)}); check ${hint}`)
}

/** Runs one request, and turns a failure to get any answer into `unreachable`. */
export async function reach<T>(family: EndpointFamily, chain: ChainKey, request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (e) {
    throw unreachable(family, chain, e)
  }
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

/**
 * The last commit that wrote one of SEF's files. `url` is one of the `*Commits` in SEF_DATA.
 * `chain` only says which run asked, for the error.
 */
export async function lastSefCommit(chain: ChainKey, url: string, token?: string): Promise<SefCommit> {
  const r = await reach("github", chain, () => fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }))
  const body: unknown = await r.json().catch(() => null)
  return parseLastCommit(body)
}

/**
 * One file under SEF's `assets/` at a commit. The raw host serves a commit's tree immutably and
 * does not count against the API limit; reading `main` instead could serve a file one cron run
 * newer or older than the commit, because the API and the raw CDN cache separately.
 */
export async function sefAsset<T>(chain: ChainKey, sha: string, file: string): Promise<T> {
  const r = await reach("sef", chain, () => fetch(`${SEF_DATA.assetsAtCommit(sha)}/${file}`))
  if (!r.ok) throw new Error(`SEF's ${file} at ${sha.slice(0, 7)} answered HTTP ${r.status}`)
  return (await r.json()) as T
}

/**
 * The subgraph a run reads: `SUBGRAPH_URL_MAINNET` or `SUBGRAPH_URL_GNOSIS` when set and not
 * empty, else the default in SUBGRAPH_ENDPOINTS, the Studio deployment of each chain. A chain
 * whose default is the local graph-node is read on GRAPH_NODE_PORT, the port `pnpm graph:up`
 * used. The same rule as subgraphEndpoints, over the environment instead of the build. One
 * variable per chain, because `pnpm test:parity` runs both packages from one environment.
 */
export function subgraphEndpoint(chain: ChainKey): string {
  const set = chain === "mainnet" ? process.env.SUBGRAPH_URL_MAINNET : process.env.SUBGRAPH_URL_GNOSIS
  if (set) return set
  const preset = SUBGRAPH_ENDPOINTS[chain]
  if (!isLocalSubgraphUrl(preset)) return preset
  return localSubgraphUrl(chain, process.env.GRAPH_NODE_PORT || DEFAULT_GRAPH_NODE_PORT)
}

/**
 * One GraphQL query. Studio answers an unknown slug or version with HTTP 200 and
 * {"message":"Not found"}, and a gateway failure with an HTML page; both throw a sentence
 * that names what to check and leaves the URL out. A retired Studio version label is the
 * usual cause of "Not found": a deploy moves the default in packages/core.
 */
export async function querySubgraph<T>(chain: ChainKey, endpoint: string, query: string): Promise<T> {
  const variable = chain === "mainnet" ? "SUBGRAPH_URL_MAINNET" : "SUBGRAPH_URL_GNOSIS"
  const hint = `check ${variable}, or the default in packages/core when it is unset`
  const r = await reach("subgraph", chain, () => fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  }))
  if (!r.ok) throw new Error(`the ${chain} subgraph answered HTTP ${r.status}; ${hint}`)
  const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[]; message?: string }
  if (j.errors) throw new Error(`the ${chain} subgraph: ${j.errors.map((e) => e.message).join("; ")}`)
  if (!j.data) throw new Error(`the ${chain} subgraph answered ${j.message ? `"${j.message}"` : "no data"}; ${hint}`)
  return j.data
}

/** A reader for block numbers and timestamps on one chain, through the same RPC order as the rest. */
export function chainReader(chain: ChainKey) {
  const client = createPublicClient({ chain: CHAINS[chain], transport: fallback(rpcUrls(chain).map((u) => http(u))) })
  const floor = chain === "mainnet" ? CONTRACTS.staking.deployBlock : CONTRACTS.consensus.deployBlock
  return {
    head: () => reach("rpc", chain, () => client.getBlockNumber()),
    /** The block at an instant on this chain. See blockAtTimestamp for `side`. */
    blockAt: async (at: Date, side: "first" | "last", head: bigint) =>
      blockAtTimestamp({
        timestampOf: async (n) => (await reach("rpc", chain, () => client.getBlock({ blockNumber: n }))).timestamp,
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

/**
 * Records one chain's state as a Markdown table row in `PARITY_STATE_DIR`, so the workflow can
 * show both chains in one table after both runs. Does nothing when the variable is unset.
 */
export function recordState(chain: ChainKey, state: ParityState, reason: string): void {
  const dir = process.env.PARITY_STATE_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const name = chain === "mainnet" ? "Mainnet" : "Gnosis"
  writeFileSync(join(dir, `${chain}.md`), `| ${name} | ${state} | ${reason.replaceAll("|", "\\|")} |\n`)
}
