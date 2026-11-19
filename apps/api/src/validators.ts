import { createPublicClient, fallback, getAddress, http, isAddress, type Address } from "viem"
import { normalize } from "viem/ens"
import { CHAINS, PUBLIC_RPC_URLS, SEF_DATA, participationWindow, programmePhase, type SefValidator } from "@cobuilders/safenet-core"
import { ApiError, array, boolean, json, malformed, object, string, type Fetcher, type Result } from "./upstream.js"

export type EnsLookup = (address: Address) => Promise<string | null>
export function ensLookup(fetcher: Fetcher): EnsLookup {
  const client = createPublicClient({
    chain: CHAINS.mainnet,
    transport: fallback(PUBLIC_RPC_URLS.mainnet.map(url => http(url, { timeout: 2000, retryCount: 0, fetchFn: fetcher })), { retryCount: 0 }),
  })
  return async address => {
    const name = await client.getEnsName({ address, universalResolverAddress: CHAINS.mainnet.contracts.ensUniversalResolver.address })
    if (!name) return null
    const resolved = await client.getEnsAddress({ name: normalize(name) })
    return resolved?.toLowerCase() === address.toLowerCase() ? name : null
  }
}
export function address(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new ApiError("invalid_address", 400, "Supply a valid validator address.")
  return getAddress(value.toLowerCase())
}
function fraction(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw malformed()
  return value
}
export function validator(value: unknown): SefValidator {
  const v = object(value)
  if (typeof v.address !== "string" || !isAddress(v.address, { strict: false })) throw malformed()
  return {
    // SEF's display name, kept verbatim. validators() replaces it with a confirmed ENS name.
    address: getAddress(v.address.toLowerCase()), label: string(v.label), commission: fraction(v.commission),
    is_active: boolean(v.is_active), participation_rate_14d: v.participation_rate_14d === null ? null : fraction(v.participation_rate_14d),
  }
}
/**
 * When SEF's update job last succeeded on `main`, in milliseconds, or undefined when GitHub does
 * not say. Never throws: without an answer the caller keeps the file's commit time.
 */
async function lastUpdateRun(fetcher: Fetcher, headers: Headers, now: number): Promise<number | undefined> {
  try {
    const run = object(array(object(await json(fetcher, SEF_DATA.updateRuns, { headers })).workflow_runs)[0])
    if (run.status !== "completed" || run.conclusion !== "success" || run.head_branch !== "main") return undefined
    const started = Date.parse(string(run.run_started_at))
    return Number.isFinite(started) && started <= now + 60_000 ? started : undefined
  } catch {
    return undefined
  }
}
export async function validators(fetcher: Fetcher, lookup: EnsLookup, now: number, githubToken?: string): Promise<Result<SefValidator[]>> {
  const headers = new Headers({ "User-Agent": "safenet-api", Accept: "application/vnd.github+json" })
  if (githubToken) headers.set("Authorization", `Bearer ${githubToken}`)
  const [answer, run] = await Promise.all([
    json(fetcher, SEF_DATA.validatorInfoCommits, { headers }), lastUpdateRun(fetcher, headers, now),
  ])
  const latest = object(array(answer)[0]), sha = string(latest.sha)
  if (!/^[a-f0-9]{40}$/.test(sha)) throw malformed()
  const committedAt = string(object(object(latest.commit).committer).date)
  const committed = Date.parse(committedAt)
  if (!Number.isFinite(committed) || committed > now + 60_000) throw malformed()
  // SEF's job recomputes the rates on every run and commits the file only when a value changed.
  // Equal rates leave the last commit old while the data is current, so the data is as fresh as
  // the newer of that commit and the job's last successful run, which also fixes the window.
  const published = run !== undefined && run > committed ? run : committed
  const publishedAt = new Date(published).toISOString()
  if (now - published > SEF_DATA.staleAfterMs) throw new ApiError("stale_upstream", 503, "SEF validator data is not current.")
  const data = array(await json(fetcher, `${SEF_DATA.assetsAtCommit(sha)}/validator-info.json`)).map(validator)
  if (!data.length || data.length > 100 || new Set(data.map(v => v.address)).size !== data.length) throw malformed()
  // A confirmed ENS name wins, then SEF's own label, so a validator without ENS keeps the name
  // validator-info.json gives it. The label is never empty: a blank SEF label becomes the address.
  const labels = { ens: 0, sef: 0, address: 0, unavailable: 0 }
  await Promise.all(data.map(async v => {
    let name: string | null = null
    try { name = await lookup(address(v.address)) } catch { labels.unavailable++ }
    if (name) { v.label = name; labels.ens++ } else if (v.label.trim()) labels.sef++
    else { v.label = v.address; labels.address++ }
  }))
  const window = participationWindow(new Date(published))
  return {
    data,
    // publishedAt is the instant the freshness and the window rest on; committedAt is the file's.
    sources: [{ source: "sef", commit: sha, committedAt, publishedAt,
      publishedBy: published === committed ? "file commit" : "update run", checkedAt: new Date(now).toISOString(),
      programme: programmePhase(new Date(published)), window,
      // is_active and commission retain SEF's semantics; they are not on-chain registration.
      labels: { source: "forward-confirmed ENS, else SEF label, else address", ...labels } }],
    expiresAt: published + SEF_DATA.staleAfterMs,
  }
}
export function findValidator(rows: SefValidator[], target: Address): SefValidator {
  const found = rows.find(v => v.address.toLowerCase() === target.toLowerCase())
  if (!found) throw new ApiError("not_found", 404, "The validator is not listed by SEF.")
  return found
}
