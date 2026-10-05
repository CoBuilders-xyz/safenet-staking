/**
 * Reading the files SEF publishes at safe-fndn/safenet-beta-data.
 *
 * Shapes come from packages/core/src/sef.ts, which records when each was read off the live file.
 */
import { parseUnits } from "viem"
import {
  PARTICIPATION_WINDOW_DAYS,
  SEF_DATA,
  participationWindow,
  rewardProofUrl,
  type SefNetworkInfo,
  type SefRewardProof,
  type SefRewardsLatest,
  type SefValidator,
} from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"

/** The window a published participation rate covers. Every rate is shown with one. */
export interface ParticipationWindow {
  readonly days: number
  /** Null when SEF's publish time could not be read. Then only the length is known. */
  readonly start: Date | null
  readonly end: Date | null
  readonly publishedAt: Date | null
  readonly commit: string | null
  /** Why start and end are null. Absent when they are known. */
  readonly unknownBecause?: string
}

async function get(ctx: Context, url: string, what: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await ctx.fetch(url, init)
  } catch {
    throw new SafenetError(`Could not reach ${what}`)
  }
  return res
}

export async function fetchSefJson<T>(ctx: Context, url: string, what: string): Promise<T> {
  const res = await get(ctx, url, what)
  if (!res.ok) throw new SafenetError(`Could not read ${what}: the server answered HTTP ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new SafenetError(`${what} is not valid JSON`)
  }
}

/** SEF writes amounts as decimal strings with up to 18 places. Parsed exactly, never via Number. */
export function parseSefAmount(value: string, what: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new SafenetError(`${what} is not a SAFE amount: ${value}`)
  return parseUnits(value, 18)
}

/** A wei amount SEF writes as a decimal integer string. */
export function parseWei(value: string, what: string): bigint {
  if (!/^\d+$/.test(value)) throw new SafenetError(`${what} is not a wei amount: ${value}`)
  return BigInt(value)
}

function assertValidators(data: unknown): asserts data is SefValidator[] {
  const ok =
    Array.isArray(data) &&
    data.every(
      (v) =>
        typeof v === "object" && v !== null &&
        typeof v.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.address) &&
        typeof v.label === "string" &&
        typeof v.is_active === "boolean" &&
        typeof v.commission === "number" &&
        typeof v.participation_rate_14d === "number",
    )
  if (!ok) throw new SafenetError("SEF's validator-info.json no longer has the shape this tool reads")
}

/** The validator list as SEF publishes it on `main`, without the window. */
export async function fetchValidators(ctx: Context): Promise<SefValidator[]> {
  const data = await fetchSefJson<unknown>(ctx, SEF_DATA.validatorInfo, "SEF's validator-info.json")
  assertValidators(data)
  return data
}

/**
 * The validator list with the window its rates cover.
 *
 * The window comes from the commit that last wrote the file, and the file is read AT that
 * commit: the GitHub API and the raw CDN are separate caches, and for a few minutes after a
 * publish they can disagree by a whole three-hour period. When the API does not answer, the
 * file is read from `main` and the window is reported as unknown, never guessed.
 */
/** The commit that last wrote validator-info.json, or why it could not be read. */
async function lastPublish(
  ctx: Context,
): Promise<{ sha: string; date: Date } | { unknownBecause: string }> {
  let res: Response
  try {
    res = await ctx.fetch(SEF_DATA.validatorInfoCommits, {
      headers: {
        accept: "application/vnd.github+json",
        ...(ctx.githubToken ? { authorization: `Bearer ${ctx.githubToken}` } : {}),
      },
    })
  } catch {
    return { unknownBecause: "the GitHub API could not be reached" }
  }
  if (!res.ok) return { unknownBecause: `the GitHub API answered HTTP ${res.status}` }
  const commits = (await res.json().catch(() => undefined)) as
    | { sha?: string; commit?: { committer?: { date?: string } } }[]
    | undefined
  const sha = commits?.[0]?.sha
  const date = commits?.[0]?.commit?.committer?.date
  if (!sha || !date || Number.isNaN(Date.parse(date))) {
    return { unknownBecause: "the GitHub API returned no usable commit for the file" }
  }
  return { sha, date: new Date(date) }
}

/**
 * The validator list with the window its rates cover.
 *
 * The window comes from the commit that last wrote the file, and the file is read AT that
 * commit: the GitHub API and the raw CDN are separate caches, and for a few minutes after a
 * publish they can disagree by a whole three-hour period. When the API does not answer, the
 * file is read from `main` and the window is reported as unknown, never guessed.
 */
export async function fetchValidatorsWithWindow(
  ctx: Context,
): Promise<{ validators: SefValidator[]; window: ParticipationWindow }> {
  const publish = await lastPublish(ctx)
  if ("unknownBecause" in publish) {
    return {
      validators: await fetchValidators(ctx),
      window: {
        days: PARTICIPATION_WINDOW_DAYS, start: null, end: null, publishedAt: null, commit: null,
        unknownBecause: publish.unknownBecause,
      },
    }
  }
  const data = await fetchSefJson<unknown>(
    ctx,
    `${SEF_DATA.assetsAtCommit(publish.sha)}/validator-info.json`,
    "SEF's validator-info.json",
  )
  assertValidators(data)
  const { start, end } = participationWindow(publish.date)
  return {
    validators: data,
    window: {
      days: PARTICIPATION_WINDOW_DAYS, start, end, publishedAt: publish.date, commit: publish.sha,
    },
  }
}

export function fetchRewardsLatest(ctx: Context): Promise<SefRewardsLatest> {
  return fetchSefJson<SefRewardsLatest>(ctx, SEF_DATA.rewardsLatest, "SEF's rewards/latest.json")
}

export function fetchNetworkInfo(ctx: Context): Promise<SefNetworkInfo> {
  return fetchSefJson<SefNetworkInfo>(ctx, SEF_DATA.networkInfo, "SEF's network-info.json")
}

function isProof(data: unknown): data is SefRewardProof {
  if (typeof data !== "object" || data === null) return false
  const o = data as Record<string, unknown>
  return (
    typeof o.cumulativeAmount === "string" && /^\d+$/.test(o.cumulativeAmount) &&
    typeof o.merkleRoot === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.merkleRoot) &&
    (o.proof === null || Array.isArray(o.proof)) &&
    (o.kycAmount == null || (typeof o.kycAmount === "string" && /^\d+$/.test(o.kycAmount))) &&
    (o.kyc == null || typeof o.kyc === "boolean")
  )
}

/** The address's reward proof, or null when SEF published none: it never earned rewards. */
export async function fetchRewardProof(
  ctx: Context,
  address: string,
): Promise<{ proof: SefRewardProof | null; url: string }> {
  const url = rewardProofUrl(address)
  const res = await get(ctx, url, "SEF's reward proof file")
  if (res.status === 404) return { proof: null, url }
  if (!res.ok) throw new SafenetError(`Could not read SEF's reward proof file: the server answered HTTP ${res.status}`)
  const data: unknown = await res.json().catch(() => undefined)
  if (!isProof(data)) throw new SafenetError("SEF's reward proof file no longer has the shape this tool reads")
  return { proof: data, url }
}
