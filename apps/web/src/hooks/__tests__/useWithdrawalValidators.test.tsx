import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { getAddress, zeroAddress } from "viem"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { answerOperations, meta, mockRequest, queryWrapper } from "@/__tests__/subgraph-mocks"
import { deployBlock } from "@/config/contracts"
import { useWithdrawalValidators } from "../useWithdrawalValidators"

vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))

const mockClient = {
  readContract: vi.fn(),
  getLogs: vi.fn(),
  getBlockNumber: vi.fn(),
}
const mockUseAccount = vi.fn()
const mockUseReadContract = vi.fn()

vi.mock("wagmi", () => ({
  usePublicClient: () => mockClient,
  useAccount: () => mockUseAccount(),
  useReadContract: (...args: unknown[]) => mockUseReadContract(...args),
}))

// A staker as a wallet reports it: checksummed, with upper-case letters.
const STAKER = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
const V1 = getAddress(TEST_ACCOUNTS.validator1)
const V2 = getAddress(TEST_ACCOUNTS.validator2)
const INDEXED_BLOCK = 26_000_000
const HEAD = BigInt(INDEXED_BLOCK + 5)

/** The queue 7 → 9: withdrawalNodes answers (amount, claimableAt, previous, next). */
function queueOf(ids: bigint[]) {
  mockUseReadContract.mockReturnValue({ data: [ids[0], ids[ids.length - 1]] })
  mockClient.readContract.mockImplementation(async ({ args }: { args: [string, bigint] }) => {
    const i = ids.indexOf(args[1])
    return [1n, 1n, ids[i - 1] ?? 0n, ids[i + 1] ?? 0n]
  })
}

const indexed = (rows: Array<[id: string, validator: string]>) => ({
  StakerWithdrawalValidators: {
    _meta: meta(30, INDEXED_BLOCK),
    withdrawals: rows.map(([id, validator]) => ({ id, validator: { id: validator } })),
  },
})

const render = () => renderHook(() => useWithdrawalValidators(), { wrapper: queryWrapper() })

describe("useWithdrawalValidators", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockReset()
    mockUseAccount.mockReturnValue({ address: STAKER })
    mockClient.getBlockNumber.mockResolvedValue(HEAD)
    mockClient.getLogs.mockResolvedValue([])
    queueOf([7n, 9n])
  })

  it("resolves each withdrawal from the subgraph, in queue order, without a log scan", async () => {
    answerOperations(indexed([["9", V2.toLowerCase()], ["7", V1.toLowerCase()]]))

    const { result } = render()

    await waitFor(() => expect(result.current.data).toEqual([V1, V2]))
    expect(mockClient.getLogs).not.toHaveBeenCalled()
  })

  it("asks the subgraph for the lowercase staker and returns checksummed validators", async () => {
    answerOperations(indexed([["7", V1.toLowerCase()], ["9", V2.toLowerCase()]]))

    const { result } = render()

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(STAKER).not.toBe(STAKER.toLowerCase())
    expect(mockRequest.mock.calls[0][0].variables).toEqual({ staker: STAKER.toLowerCase() })
    expect(result.current.data).toEqual([V1, V2])
  })

  it("reads a withdrawal the subgraph has not indexed yet from the logs after its last block", async () => {
    answerOperations(indexed([["7", V1.toLowerCase()]]))
    mockClient.getLogs.mockResolvedValue([{ args: { withdrawalId: 9n, validator: V2 } }])

    const { result } = render()

    await waitFor(() => expect(result.current.data).toEqual([V1, V2]))
    expect(mockClient.getLogs).toHaveBeenCalledOnce()
    expect(mockClient.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: BigInt(INDEXED_BLOCK) + 1n, args: { staker: STAKER } }),
    )
  })

  it("scans from the deploy block when the subgraph does not answer", async () => {
    answerOperations({ StakerWithdrawalValidators: new Error("HTTP 500") })
    mockClient.getLogs.mockResolvedValue([
      { args: { withdrawalId: 7n, validator: V1 } },
      { args: { withdrawalId: 9n, validator: V2 } },
    ])

    const { result } = render()

    await waitFor(() => expect(result.current.data).toEqual([V1, V2]))
    expect(mockClient.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: deployBlock }))
  })

  it("scans from the deploy block on a fork, where the subgraph is ahead of the chain", async () => {
    answerOperations(indexed([]))
    mockClient.getBlockNumber.mockResolvedValue(BigInt(INDEXED_BLOCK) - 1000n)
    mockClient.getLogs.mockResolvedValue([
      { args: { withdrawalId: 7n, validator: V1 } },
      { args: { withdrawalId: 9n, validator: V2 } },
    ])

    const { result } = render()

    await waitFor(() => expect(result.current.data).toEqual([V1, V2]))
    expect(mockClient.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: deployBlock }))
  })

  it("leaves the zero address for a withdrawal neither source resolves", async () => {
    answerOperations(indexed([["7", V1.toLowerCase()]]))
    // What a public endpoint does with a range it refuses: every request fails.
    mockClient.getLogs.mockRejectedValue(new Error("ranges over 100 blocks are not supported"))

    const { result } = render()

    await waitFor(() => expect(result.current.data).toEqual([V1, zeroAddress]))
  })

  it("is resolving until the validators arrive, and while the queue's head is read", async () => {
    answerOperations(indexed([["7", V1.toLowerCase()], ["9", V2.toLowerCase()]]))

    const { result } = render()
    expect(result.current.isResolving).toBe(true)
    await waitFor(() => expect(result.current.isResolving).toBe(false))
    expect(result.current.data).toEqual([V1, V2])

    mockUseReadContract.mockReturnValue({ data: undefined, isLoading: true })
    expect(render().result.current.isResolving).toBe(true)
  })

  it("does not run for an empty queue", () => {
    mockUseReadContract.mockReturnValue({ data: [0n, 0n] })

    const { result } = render()

    expect(result.current.fetchStatus).toBe("idle")
    expect(result.current.isResolving).toBe(false)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
