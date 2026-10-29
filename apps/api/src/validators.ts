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
    address: getAddress(v.address.toLowerCase()), label: "", commission: fraction(v.commission),
    is_active: boolean(v.is_active), participation_rate_14d: v.participation_rate_14d === null ? null : fraction(v.participation_rate_14d),
  }
}
export async function validators(fetcher: Fetcher, lookup: EnsLookup, now: number): Promise<Result<SefValidator[]>> {
  const commits = array(await json(fetcher, SEF_DATA.validatorInfoCommits, { headers: { "User-Agent": "safenet-api", Accept: "application/vnd.github+json" } }))
  const latest = object(commits[0]), sha = string(latest.sha)
  if (!/^[a-f0-9]{40}$/.test(sha)) throw malformed()
  const publishedAt = string(object(object(latest.commit).committer).date)
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published) || published > now + 60_000) throw malformed()
  if (now - published > SEF_DATA.staleAfterMs) throw new ApiError("stale_upstream", 503, "SEF validator data is not current.")
  const data = array(await json(fetcher, `${SEF_DATA.assetsAtCommit(sha)}/validator-info.json`)).map(validator)
  if (!data.length || data.length > 100 || new Set(data.map(v => v.address)).size !== data.length) throw malformed()
  let failedLabels = 0
  await Promise.all(data.map(async v => {
    try { v.label = await lookup(address(v.address)) ?? "" } catch { failedLabels++ }
  }))
  const window = participationWindow(new Date(published))
  return {
    data,
    sources: [{ source: "sef", commit: sha, publishedAt, checkedAt: new Date(now).toISOString(),
      programme: programmePhase(new Date(published)), window,
      // is_active and commission retain SEF's semantics; they are not on-chain registration.
      labels: { source: "forward-confirmed ENS", unavailable: failedLabels } }],
    expiresAt: published + SEF_DATA.staleAfterMs,
  }
}
export function findValidator(rows: SefValidator[], target: Address): SefValidator {
  const found = rows.find(v => v.address.toLowerCase() === target.toLowerCase())
  if (!found) throw new ApiError("not_found", 404, "The validator is not listed by SEF.")
  return found
}
