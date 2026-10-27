/**
 * Reading the files SEF publishes: the validator and network files at safe-fndn/safenet-data,
 * and the reward files from SEF's IPFS dataset behind its ENS name, or from that repository
 * while the name is empty. The order lives in packages/core/src/rewards-source.ts, which the
 * interface reads too, so the CLI, the MCP server and the web show the same rewards.
 *
 * Shapes come from packages/core/src/sef.ts, which records when each was read off the live file.
 */
import { parseUnits } from "viem"
import {
  PARTICIPATION_WINDOW_DAYS,
  REWARDS_LATEST_PATH,
  REWARDS_SOURCE_RETRY_MS,
  REWARDS_SOURCE_STALE_MS,
  RewardsReadError,
  SEF_DATA,
  SEF_REWARDS_ENS_NAME,
  describeAttempt,
  failureReason,
  participationWindow,
  readRewardsFile,
  resolveRewardsSource,
  rewardProofPath,
  type RewardsRead,
  type RewardsSource,
  type SefNetworkInfo,
  type SefRewardProof,
  type SefRewardsLatest,
} from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"

/**
 * One validator in SEF's `validator-info.json`: core's `SefValidator`, field for field.
 *
 * Declared here because the library's public declarations return it, and core is not published,
 * so a consumer could not resolve core's name. `sef.test.ts` fails to type-check if the two differ.
 */
export interface SefValidator {
  address: string
  commission: number
  is_active: boolean
  label: string
  /** A double. Null when SEF publishes no rate. */
  participation_rate_14d: number | null
}

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

/**
 * Where the reward files were read from. Declared here, not taken from core, because the
 * library's public declarations return it and core is not published.
 */
export interface RewardsSourceUsed {
  /**
   * `ens`: SEF's IPFS dataset behind the ENS name, the canonical source. `repository`:
   * safe-fndn/safenet-data, a mirror, read while the name has no usable contenthash.
   */
  readonly kind: "ens" | "repository" | "override"
  /** The base the file was read from. `latest.json` and `proofs/` sit under it. */
  readonly url: string
  /** The IPFS gateway, for `ens`. */
  readonly gateway: string | null
  /**
   * Every source asked, in order, ending with the one above. A gateway's `not found` on every
   * gateway, while the repository has the file, points at the dataset's layout, not at an outage.
   */
  readonly tried: readonly {
    readonly kind: "ens" | "repository" | "override"
    readonly url: string
    readonly gateway: string | null
    readonly outcome: "found" | "not found" | "timeout" | "skipped" | "error"
    /** Why, for `error`, with every URL cut to its host. */
    readonly reason: string | null
  }[]
  readonly ens: {
    readonly name: string
    /** `set`, or why the dataset was not tried: `empty`, `unsupported` or `unreadable`. */
    readonly status: "set" | "empty" | "unsupported" | "unreadable"
    /** The raw contenthash, when one was read. */
    readonly contenthash: string | null
    readonly reason: string | null
  }
}

function sourceUsed(source: RewardsSource, read: RewardsRead<unknown>): RewardsSourceUsed {
  const { ens } = source
  const { base } = read
  return {
    kind: base.kind,
    url: base.url,
    gateway: base.gateway ?? null,
    tried: read.tried.map((a) => ({
      kind: a.base.kind,
      url: a.base.url,
      gateway: a.base.gateway ?? null,
      outcome: a.outcome,
      reason: a.outcome === "error" ? failureReason(a.error) : null,
    })),
    ens: {
      name: SEF_REWARDS_ENS_NAME,
      status: ens.status,
      contenthash: ens.status === "set" || ens.status === "unsupported" ? ens.raw : null,
      reason: ens.status === "unsupported" || ens.status === "unreadable" ? ens.reason : null,
    },
  }
}

/**
 * The resolved ENS name and the bases to try, reused per context for an hour, or for a minute
 * when the chain could not be read. The MCP server keeps one context while it runs, so it sees
 * SEF populate the name within the hour, and one failed RPC call does not hold it on the mirror.
 */
const resolved = new WeakMap<Context, { until: number; source: Promise<RewardsSource> }>()

export function rewardsSource(ctx: Context): Promise<RewardsSource> {
  const cached = resolved.get(ctx)
  if (cached && cached.until > Date.now()) return cached.source
  const source = resolveRewardsSource(ctx.client, { gateway: ctx.ipfsGateway })
  const entry = { until: Date.now() + REWARDS_SOURCE_STALE_MS, source }
  resolved.set(ctx, entry)
  void source.then((s) => {
    if (s.ens.status === "unreadable") entry.until = Date.now() + REWARDS_SOURCE_RETRY_MS
  })
  return source
}

/**
 * One reward file from the first source that has it, checked against `isShape` at each source,
 * so a file of the wrong shape falls through like a failed request. Null when the repository,
 * whose layout is known, answered 404, whatever the gateways did. (Core also settles on an
 * override's 404; the CLI configures no override.)
 * When only the repository was tried, its own error is thrown unchanged.
 */
async function readRewards<T>(
  ctx: Context,
  path: string,
  what: string,
  isShape: (data: unknown) => data is T,
): Promise<{ value: T | null; url: string; source: RewardsSourceUsed }> {
  const source = await rewardsSource(ctx)
  try {
    const read = await readRewardsFile({
      bases: source.bases,
      path,
      attempt: async (url, signal) => {
        const res = await get(ctx, url, what, { signal })
        if (res.status === 404) return null
        if (!res.ok) throw new SafenetError(`Could not read ${what}: the server answered HTTP ${res.status}`)
        const data: unknown = await res.json().catch(() => {
          throw new SafenetError(`${what} is not valid JSON`)
        })
        if (!isShape(data)) throw new SafenetError(`${what} no longer has the shape this tool reads`)
        return data
      },
    })
    return { value: read.value, url: read.url, source: sourceUsed(source, read) }
  } catch (error) {
    if (!(error instanceof RewardsReadError)) throw error
    const [only] = error.attempts
    if (error.attempts.length === 1 && only?.outcome === "error" && only.error instanceof SafenetError) throw only.error
    throw new SafenetError(`Could not read ${what} from any source: ${error.attempts.map(describeAttempt).join("; ")}`)
  }
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
        (typeof v.participation_rate_14d === "number" || v.participation_rate_14d === null),
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

const isRecord = (data: unknown): data is Record<string, unknown> =>
  typeof data === "object" && data !== null && !Array.isArray(data)

/**
 * The fields this tool reads, checked before the data is typed. A missing field would otherwise
 * surface later as a TypeError with no hint that SEF changed its file.
 */
function isRewardsLatest(data: unknown): data is SefRewardsLatest {
  return (
    isRecord(data) &&
    typeof data.epoch === "number" &&
    typeof data.merkleRoot === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.merkleRoot) &&
    typeof data.rewardsUntil === "string" && !Number.isNaN(Date.parse(data.rewardsUntil)) &&
    typeof data.tokenTotal === "string" &&
    typeof data.unpaidAmount === "string"
  )
}

function isNetworkInfo(data: unknown): data is SefNetworkInfo {
  return (
    isRecord(data) &&
    typeof data.total_staked_amount === "string" &&
    typeof data.total_transactions_checked === "number"
  )
}

/** SEF's rewards/latest.json, and where it was read from. */
export async function readRewardsLatest(
  ctx: Context,
): Promise<{ latest: SefRewardsLatest; source: RewardsSourceUsed }> {
  const what = "SEF's rewards/latest.json"
  const { value, source } = await readRewards(ctx, REWARDS_LATEST_PATH, what, isRewardsLatest)
  if (!value) throw new SafenetError(`Could not read ${what}: the server answered HTTP 404`)
  return { latest: value, source }
}

export async function fetchNetworkInfo(ctx: Context): Promise<SefNetworkInfo> {
  const data = await fetchSefJson<unknown>(ctx, SEF_DATA.networkInfo, "SEF's network-info.json")
  if (!isNetworkInfo(data)) throw new SafenetError("SEF's network-info.json no longer has the shape this tool reads")
  return data
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

/**
 * The address's reward proof, or null when no source has one: it never earned rewards. `url` is
 * the file that answered, or, with no proof, the file whose 404 settled it: the repository's.
 */
export async function fetchRewardProof(
  ctx: Context,
  address: string,
): Promise<{ proof: SefRewardProof | null; url: string; source: RewardsSourceUsed }> {
  const { value, url, source } = await readRewards(ctx, rewardProofPath(address), "SEF's reward proof file", isProof)
  return { proof: value, url, source }
}
