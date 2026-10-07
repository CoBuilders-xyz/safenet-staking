import { useCallback } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { usePublicClient } from "wagmi"
import {
  REWARDS_SOURCE_STALE_MS,
  RewardsReadError,
  readRewardsFile,
  resolveRewardsSource,
  rewardsDataBases,
  type EnsReadClient,
  type RewardsDataBase,
  type RewardsEnsState,
  type RewardsRead,
} from "@cobuilders/safenet-core"

/**
 * A URL that replaces every source of SEF's reward files, ENS and the repository alike. The fork
 * suite and the manual QA fork point it at the files as they stood at the fork block.
 */
export const rewardsBaseOverride: string | undefined = import.meta.env.VITE_REWARDS_BASE_URL || undefined

/** An IPFS gateway to try before the public ones in core. */
const ipfsGateway: string | undefined = import.meta.env.VITE_IPFS_GATEWAY || undefined

/** The bases to try, and what SEF's ENS name held. `ens` is null under the override: it is not read. */
export interface WebRewardsSource {
  readonly ens: RewardsEnsState | null
  readonly bases: readonly RewardsDataBase[]
}

/** A reward file and where it came from. */
export interface RewardsFileRead<T> extends RewardsRead<T> {
  readonly ens: RewardsEnsState | null
}

export async function resolveWebRewardsSource(
  client: EnsReadClient | undefined,
  override: string | undefined = rewardsBaseOverride,
): Promise<WebRewardsSource> {
  if (override) return { ens: null, bases: [{ url: override.replace(/\/+$/, ""), kind: "override" }] }
  if (!client) {
    const ens: RewardsEnsState = { status: "unreadable", reason: "no Mainnet client" }
    return { ens, bases: rewardsDataBases(ens) }
  }
  return resolveRewardsSource(client, { gateway: ipfsGateway })
}

/** A failed chain read is retried after a minute, not reused for the hour a resolution is. */
const UNREADABLE_STALE_MS = 60_000

/**
 * The ENS resolution, cached for the session under one query key, so every reward file read in
 * the same hour uses the same bases. It never fails: a failed read falls back to the repository.
 */
function rewardsSourceQuery(client: EnsReadClient | undefined) {
  return {
    queryKey: ["rewardsSource"],
    queryFn: () => resolveWebRewardsSource(client),
    staleTime: (query: { state: { data?: WebRewardsSource } }) =>
      query.state.data?.ens?.status === "unreadable" ? UNREADABLE_STALE_MS : REWARDS_SOURCE_STALE_MS,
    retry: false,
  }
}

export type RewardsAttempt<T> = (url: string, signal: AbortSignal) => Promise<T | null>

/**
 * Reads one reward file from the first source that has it: SEF's IPFS dataset when its ENS
 * name is set, then the repository. A source that fails, times out or answers 404 falls through.
 */
export async function readRewardsFileThrough<T>(
  queryClient: QueryClient,
  client: EnsReadClient | undefined,
  path: string,
  attempt: RewardsAttempt<T>,
  signal?: AbortSignal,
): Promise<RewardsFileRead<T>> {
  const source = await queryClient.fetchQuery(rewardsSourceQuery(client))
  try {
    const read = await readRewardsFile({ bases: source.bases, path, attempt, signal })
    return { ...read, ens: source.ens }
  } catch (error) {
    // With one source, its own error says more than a list of one.
    if (error instanceof RewardsReadError && error.failures.length === 1 && error.failures[0]!.kind === "error") {
      throw error.failures[0]!.error
    }
    throw error
  }
}

/** The reader the reward hooks call from their query functions. */
export function useRewardsFileReader() {
  const queryClient = useQueryClient()
  const client = usePublicClient()
  return useCallback(
    <T>(path: string, attempt: RewardsAttempt<T>, signal?: AbortSignal) =>
      readRewardsFileThrough(queryClient, client, path, attempt, signal),
    [queryClient, client],
  )
}
