import { useAccount, usePublicClient } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { merkleDropAbi } from "@cobuilders/safenet-core"
import { activeChain } from "@/config/chains"
import { getContractAddresses } from "@/config/contracts"
import { SUBGRAPH_URLS } from "@/config/subgraphs"
import { readRewardHistory, RewardHistoryError, type HistoryFailure, type RewardHistory } from "@/lib/rewardHistory"
import { assessFreshness, readFreshness } from "@/lib/subgraph"

export type RewardHistoryState =
  | { status: "disconnected" | "loading" }
  | { status: HistoryFailure }
  | { status: "ready"; data: RewardHistory }

export function useRewardHistory() {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: activeChain.id })
  const { merkleDrop } = getContractAddresses(activeChain.id)
  const url = SUBGRAPH_URLS.mainnet
  const query = useQuery({
    queryKey: ["reward-history", address?.toLowerCase(), activeChain.id, merkleDrop, url],
    queryFn: async ({ signal }): Promise<RewardHistoryState> => {
      if (!address || !client || !merkleDrop || !url) return { status: "unavailable" }
      // Bound the full load, including archive RPCs. Late results are never displayed.
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener("abort", abort, { once: true })
      const timer = setTimeout(abort, 30_000)
      try {
        signal.throwIfAborted()
        const timeout = new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new RewardHistoryError("unavailable")), { once: true })
        })
        const data = await Promise.race([readRewardHistory(url, address, {
          cumulativeClaimed: (blockNumber) => client.readContract({
            address: merkleDrop, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [address], blockNumber,
          }),
          merkleRoot: (blockNumber) => client.readContract({
            address: merkleDrop, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber,
          }),
        }, controller.signal), timeout])
        return { status: "ready", data }
      } catch (error) {
        return { status: error instanceof RewardHistoryError ? error.reason : "unavailable" }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
      }
    },
    enabled: !!address && !!client && !!merkleDrop && !!url,
    retry: false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  let state: RewardHistoryState = !address ? { status: "disconnected" }
    : !client || !merkleDrop || !url ? { status: "unavailable" }
    : query.data ?? { status: "loading" }
  if (state.status === "ready") {
    const f = state.data.freshness
    if (assessFreshness(readFreshness({
      block: { number: f.block, timestamp: f.blockTimestamp }, hasIndexingErrors: f.hasIndexingErrors,
    }, Date.now()))) state = { status: "stale" }
  }
  return { state, address, refetch: query.refetch }
}
