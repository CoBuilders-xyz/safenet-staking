import { useQuery } from "@tanstack/react-query"
import { getAddress } from "viem"
import type { Address, Hex } from "viem"
import { rewardProofPath } from "@cobuilders/safenet-core"
import { useRewardsFileReader, type RewardsFileRead } from "./useRewardsSource"

export interface RewardProof {
  cumulativeAmount: string
  merkleRoot: Hex
  proof: Hex[] | null
  /** `null` is treated as absent: nothing held. */
  kycAmount?: string | null
  /** `null` is treated as absent: not marked as checked. */
  kyc?: boolean | null
}

function isValidProof(data: unknown): data is RewardProof {
  if (typeof data !== "object" || data === null) return false
  const obj = data as Record<string, unknown>
  if (typeof obj.cumulativeAmount !== "string") return false
  if (typeof obj.merkleRoot !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(obj.merkleRoot)) return false
  if (
    obj.proof !== null &&
    !(
      Array.isArray(obj.proof) &&
      obj.proof.every((p) => typeof p === "string" && /^0x[0-9a-fA-F]{64}$/.test(p as string))
    )
  )
    return false
  // SEF's live files (checked 2026-10-04) omit these keys or give a string and a boolean.
  // A null is accepted as absent, so a change in how they serialise cannot lock users out.
  if (obj.kycAmount != null && (typeof obj.kycAmount !== "string" || !/^\d+$/.test(obj.kycAmount))) return false
  if (obj.kyc != null && typeof obj.kyc !== "boolean") return false
  return true
}

/** One source's proof for the address: null on a 404, an error otherwise. */
async function fetchProofAt(url: string, signal: AbortSignal): Promise<RewardProof | null> {
  const response = await fetch(url, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Failed to fetch reward proof: ${response.status}`)
  const json: unknown = await response.json()
  if (!isValidProof(json)) throw new Error("Invalid reward proof format")
  return json
}

/**
 * The part of an address's reward that SEF holds back until compliance checks pass.
 * Zero when nothing is held (`kycAmount` absent, null or "0"), or when the file marks the
 * address as checked (`kyc: true`). A null `kyc` counts as not checked.
 */
export function heldPendingCompliance(proof: RewardProof | null | undefined): bigint {
  if (!proof?.kycAmount || proof.kyc === true) return 0n
  return BigInt(proof.kycAmount)
}

/** Where the proof was read from, or which source settled that there is none. */
export type RewardProofSource = Omit<RewardsFileRead<RewardProof>, "value">

/** One query, observed twice: by `useRewardProof` for the proof, by `useRewardProofSource` for its source. */
function useRewardProofRead<S>(address: Address | undefined, enabled: boolean, select: (read: RewardsFileRead<RewardProof>) => S) {
  const read = useRewardsFileReader()
  return useQuery({
    queryKey: ["rewardProof", address],
    queryFn: ({ signal }) => read(rewardProofPath(getAddress(address!)), fetchProofAt, signal),
    select,
    enabled: !!address && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

const proofOf = (read: RewardsFileRead<RewardProof>) => read.value
const sourceOf = ({ base, url, ens, tried }: RewardsFileRead<RewardProof>): RewardProofSource => ({ base, url, ens, tried })

/**
 * The address's proof from the first source that has it, SEF's IPFS dataset before the
 * repository. Null when the repository answered 404: the address never earned rewards.
 */
export function useRewardProof(address: Address | undefined, enabled = true) {
  return useRewardProofRead(address, enabled, proofOf)
}

/** Where `useRewardProof`'s answer came from. Reads nothing more: it observes the same query. */
export function useRewardProofSource(address: Address | undefined, enabled = true) {
  return useRewardProofRead(address, enabled, sourceOf).data
}
