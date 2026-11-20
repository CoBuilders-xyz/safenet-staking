import { useQuery } from "@tanstack/react-query"
import { usePublicClient, useAccount, useReadContract } from "wagmi"
import { getAddress, isAddress, type Address } from "viem"
import { indexedEvent, stakingAbi } from "@cobuilders/safenet-core"
import { getContractAddresses, deployBlock } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { SUBGRAPH_URLS } from "@/config/subgraphs"
import { StakerWithdrawalValidatorsDocument } from "@/graphql/mainnet/generated"
import { fetchSubgraph } from "@/lib/subgraph"

const MAX_BLOCK_RANGE = 49_999n
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address

const WITHDRAWAL_INITIATED_EVENT = indexedEvent("staking", "WithdrawalInitiated")

const addresses = getContractAddresses(activeChain.id)

/** While a withdrawal has no validator yet, ask again this often: the subgraph indexes it within blocks. */
export const UNRESOLVED_REFETCH_MS = 15_000

/**
 * How far past the connected chain's head the subgraph may be and still describe that chain.
 * A public endpoint can answer a few blocks behind the subgraph. A fork stays at its pinned
 * block while Mainnet moves on, and soon falls further behind than this.
 */
const HEAD_LAG_TOLERANCE_BLOCKS = 50n

interface IndexedValidators {
  byId: Map<bigint, Address>
  /** The last block the subgraph indexed. Null when it did not answer. */
  block: bigint | null
}

/**
 * The validator of each unclaimed withdrawal of `staker`, from the Mainnet subgraph. It never
 * throws: a subgraph that does not answer leaves every withdrawal to the log scan.
 */
async function indexedValidators(staker: Address, signal?: AbortSignal): Promise<IndexedValidators> {
  const byId = new Map<bigint, Address>()
  const url = SUBGRAPH_URLS.mainnet
  if (!url) return { byId, block: null }
  try {
    // Bytes filters compare lowercase hex; a checksummed address matches nothing.
    const { data, freshness } = await fetchSubgraph(
      url,
      StakerWithdrawalValidatorsDocument,
      { staker: staker.toLowerCase() },
      signal,
    )
    for (const w of data.withdrawals) {
      if (isAddress(w.validator.id, { strict: false })) byId.set(BigInt(w.id), getAddress(w.validator.id))
    }
    return { byId, block: BigInt(freshness.block) }
  } catch {
    return { byId, block: null }
  }
}

/**
 * Maps pending withdrawals to validator addresses.
 *
 * The on-chain withdrawal queue is a doubly linked list keyed by global
 * withdrawal IDs. `getPendingWithdrawals` returns `(amount, claimableAt)[]`
 * but no validator. This hook traverses the linked list from `head` to
 * collect the node IDs, then resolves each one's validator: first from the
 * Mainnet subgraph, then, for an ID the subgraph does not hold, from the
 * `WithdrawalInitiated` logs after the subgraph's last block.
 *
 * The subgraph comes first because the public RPC endpoints refuse a log scan
 * back to the deploy block: each limits `eth_getLogs` to between 50 and
 * 10,000 blocks. A scan of that length is left for an endpoint that serves
 * it, such as an Anvil fork, where the subgraph does not know the fork's own
 * withdrawals and is not read at all.
 *
 * A withdrawal neither source resolves is the zero address, and the query
 * runs again until it resolves.
 */
export function useWithdrawalValidators() {
  const client = usePublicClient()
  const { address } = useAccount()

  const { data: queueData, isLoading: isQueueLoading } = useReadContract({
    address: addresses.staking,
    abi: stakingAbi,
    functionName: "withdrawalQueues",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const head = queueData?.[0]
  const tail = queueData?.[1]

  const query = useQuery({
    queryKey: ["withdrawalValidators", address, head?.toString(), tail?.toString()],
    queryFn: async ({ signal }): Promise<Address[]> => {
      if (!client || !address || head === undefined || tail === undefined) return []

      // head == 0 means the queue is empty
      if (head === 0n) return []

      // 1. Traverse the linked list to collect node IDs in queue order.
      const nodeIds: bigint[] = []
      let currentId = head
      while (currentId !== 0n) {
        nodeIds.push(currentId)
        const node = await client.readContract({
          address: addresses.staking,
          abi: stakingAbi,
          functionName: "withdrawalNodes",
          args: [address, currentId],
        })
        // node = [amount, claimableAt, previous, next]
        currentId = node[3]
      }

      // 2. Ask the subgraph for the validator of each unclaimed withdrawal. A subgraph well past
      // this chain's head indexes another history: on a fork, a withdrawal made there can carry
      // the ID of a later Mainnet one. Its answer is then discarded.
      const [indexed, latestBlock] = await Promise.all([
        indexedValidators(address, signal),
        client.getBlockNumber(),
      ])
      const describesThisChain =
        indexed.block !== null && indexed.block <= latestBlock + HEAD_LAG_TOLERANCE_BLOCKS
      const idToValidator = describesThisChain ? indexed.byId : new Map<bigint, Address>()
      if (nodeIds.every((id) => idToValidator.has(id))) {
        return nodeIds.map((id) => idToValidator.get(id) ?? ZERO_ADDRESS)
      }

      // 3. For the rest, fetch WithdrawalInitiated events. Only the blocks the subgraph has not
      // indexed, when its answer stands: that range is short enough for a public endpoint.
      // Otherwise the scan starts at the deploy block.
      const afterIndexed = indexed.block !== null ? indexed.block + 1n : deployBlock
      const scanFrom = !describesThisChain
        ? deployBlock
        : afterIndexed > latestBlock ? latestBlock : afterIndexed
      const getEventLogs = () =>
        client.getLogs({
          address: addresses.staking,
          event: WITHDRAWAL_INITIATED_EVENT,
          args: { staker: address },
          fromBlock: scanFrom,
          toBlock: "latest",
        })
      type EventLog = Awaited<ReturnType<typeof getEventLogs>>
      let logs: EventLog
      try {
        logs = await getEventLogs()
      } catch {
        // Chunked fallback for RPC block-range limits.
        // Fetch all chunks in parallel for better latency.
        const minBlock = scanFrom > 0n ? scanFrom : 0n

        const chunkPromises: Promise<EventLog>[] = []
        let from = minBlock
        while (from <= latestBlock) {
          const to =
            from + MAX_BLOCK_RANGE > latestBlock
              ? latestBlock
              : from + MAX_BLOCK_RANGE
          chunkPromises.push(
            client
              .getLogs({
                address: addresses.staking,
                event: WITHDRAWAL_INITIATED_EVENT,
                args: { staker: address },
                fromBlock: from,
                toBlock: to,
              })
              .catch(() => [])
          )
          from = to + 1n
        }

        const chunkResults = await Promise.all(chunkPromises)
        logs = chunkResults.flat()
      }

      // A log is the chain itself, so it replaces what the subgraph said for the same ID.
      for (const log of logs) {
        const { withdrawalId, validator } = log.args
        if (withdrawalId !== undefined && validator) {
          idToValidator.set(BigInt(withdrawalId), validator)
        }
      }

      // 4. Map each linked-list node ID to its validator.
      return nodeIds.map((id) => idToValidator.get(id) ?? ZERO_ADDRESS)
    },
    staleTime: 60_000,
    // A lookup that failed, on the chain head or a queue node, is as unresolved as a zero address.
    refetchInterval: (query) =>
      query.state.status === "error" || query.state.data?.includes(ZERO_ADDRESS)
        ? UNRESOLVED_REFETCH_MS
        : false,
    enabled: !!client && !!address && head !== undefined && tail !== undefined && head !== 0n,
  })

  // True while an answer is on its way: the queue's head is being read, or the validators are.
  // False once nothing more will arrive, so a screen can stop its placeholder.
  return { ...query, isResolving: isQueueLoading || query.isFetching }
}
