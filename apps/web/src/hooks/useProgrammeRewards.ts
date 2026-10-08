import { useQuery } from "@tanstack/react-query"
import { useReadContract } from "wagmi"
import { REWARDS_LATEST_PATH, erc20Abi, merkleDropAbi, type SefRewardsLatest } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { useRewardsFileReader, type RewardsFileRead } from "./useRewardsSource"

const { merkleDrop, token } = getContractAddresses(activeChain.id)

/** SEF computes rewards for two-week periods, Tuesday to Tuesday UTC. */
export const REWARD_PERIOD_MS = 14 * 24 * 60 * 60 * 1000

const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const DECIMAL = /^\d+$/

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v))
}

/** Validate SEF's `rewards/latest.json` against the shape typed in core. */
export function parseRewardsLatest(data: unknown): SefRewardsLatest {
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>
  const valid =
    typeof o.epoch === "number" &&
    typeof o.merkleRoot === "string" && BYTES32.test(o.merkleRoot) &&
    isIsoDate(o.rewardsUntil) &&
    typeof o.tokenTotal === "string" && DECIMAL.test(o.tokenTotal) &&
    typeof o.unpaidAmount === "string" && DECIMAL.test(o.unpaidAmount) &&
    isIsoDate(o.updatedAt)
  if (!valid) throw new Error("Invalid rewards file format")
  return o as unknown as SefRewardsLatest
}

/** One source's latest.json: null on a 404, an error otherwise. */
async function fetchLatestAt(url: string, signal: AbortSignal): Promise<SefRewardsLatest | null> {
  const response = await fetch(url, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to fetch rewards file: ${response.status}`)
  return parseRewardsLatest(await response.json())
}

/** Where the published file came from: shown next to the root it carries. */
export type RewardsLatestSource = Omit<RewardsFileRead<SefRewardsLatest>, "value">

export interface ProgrammeTotals {
  /** Cumulative SAFE allocated to date, from SEF's file. */
  allocated: bigint
  /** SAFE the MerkleDrop still holds, from the chain. */
  unclaimed: bigint
  /**
   * Allocated minus the live balance. Undefined when the contract holds more than the
   * allocation, because then the difference no longer measures claims.
   */
  claimed: bigint | undefined
  /** Unclaimed as a share of allocated, in percent, two decimals. */
  unclaimedPercent: number | undefined
}

export function deriveProgramme(allocated: bigint, balance: bigint): ProgrammeTotals {
  if (balance > allocated || allocated === 0n) {
    return { allocated, unclaimed: balance, claimed: undefined, unclaimedPercent: undefined }
  }
  return {
    allocated,
    unclaimed: balance,
    claimed: allocated - balance,
    unclaimedPercent: Number((balance * 10_000n) / allocated) / 100,
  }
}

/** Root equality for bytes32 hex strings, which may differ in letter case. */
export function sameRoot(a: string | undefined, b: string | undefined): boolean | undefined {
  if (!a || !b) return undefined
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Programme-wide rewards data: SEF's published file, and the MerkleDrop's root and balance
 * on chain. `totals` is derived only when the on-chain root matches the published one. Each source keeps its own loading and error state, so a screen can fail one
 * section without failing the others. Nothing here depends on the connected wallet.
 */
export function useProgrammeRewards() {
  const read = useRewardsFileReader()
  // One query, observed twice: once for the file, once for where it came from.
  const latestQuery = {
    queryKey: ["rewardsLatest"],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const answer = await read(REWARDS_LATEST_PATH, fetchLatestAt, signal)
      if (answer.value === null) throw new Error("Failed to fetch rewards file: 404")
      return answer
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  }
  const latest = useQuery({ ...latestQuery, select: (answer): SefRewardsLatest => answer.value! })
  const latestSource = useQuery({
    ...latestQuery,
    select: ({ base, url, ens, tried }): RewardsLatestSource => ({ base, url, ens, tried }),
  }).data

  const onChainRoot = useReadContract({
    address: merkleDrop,
    abi: merkleDropAbi,
    functionName: "merkleRoot",
    query: { enabled: !!merkleDrop, staleTime: 60_000 },
  })

  const dropBalance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: merkleDrop ? [merkleDrop] : undefined,
    query: { enabled: !!merkleDrop, refetchInterval: 15_000 },
  })

  const rootMatches = sameRoot(onChainRoot.data, latest.data?.merkleRoot)

  // tokenTotal is the allocation behind the published root, so allocated minus the live
  // balance measures claims only while the contract holds that root. Before SEF's new root
  // is set and funded on chain, the difference would count unpaid rewards as claimed.
  const totals =
    rootMatches === true && latest.data && dropBalance.data !== undefined
      ? deriveProgramme(BigInt(latest.data.tokenTotal), dropBalance.data)
      : undefined

  return { merkleDrop, latest, latestSource, onChainRoot, dropBalance, totals, rootMatches }
}
