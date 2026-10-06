import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Hex,
  type Log,
} from "viem"
import { safeTokenEventsAbi } from "@cobuilders/safenet-core"
import { merkleDropAbi } from "@/abi/merkleDropAbi"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { revertedErrorName } from "@/lib/errorFormat"
import { TEST_ACCOUNTS, MOCK_TX_HASH } from "@/__tests__/test-data"
import { useClaimStep } from "../useClaimStep"

const SAFE = 10n ** 18n
const { token, merkleDrop } = getContractAddresses(activeChain.id)
const ROOT = `0x${"ab".repeat(32)}` as Hex
const PROOF = [`0x${"11".repeat(32)}` as Hex]
const INPUT = { cumulativeAmount: 100n * SAFE, merkleRoot: ROOT, proof: PROOF }
const EXECUTED_HASH = `0x${"e1".repeat(32)}` as Hex

const m = vi.hoisted(() => ({
  simulate: vi.fn(),
  write: vi.fn(),
  writeReset: vi.fn(),
  send: vi.fn(),
  sendReset: vi.fn(),
  writeState: {} as Record<string, unknown>,
  sendState: {} as Record<string, unknown>,
  callsStatus: undefined as unknown,
  capabilities: undefined as unknown,
  receipt: {} as Record<string, unknown>,
  receiptHash: vi.fn(),
}))

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: TEST_ACCOUNTS.user }),
  usePublicClient: () => ({ simulateContract: m.simulate }),
  useWriteContract: () => ({ mutate: m.write, reset: m.writeReset, isPending: false, isSuccess: false, error: null, ...m.writeState }),
  useSendCalls: () => ({ mutate: m.send, reset: m.sendReset, isPending: false, error: null, ...m.sendState }),
  useCallsStatus: () => ({ data: m.callsStatus }),
  useCapabilities: () => ({ data: m.capabilities, isError: false }),
  useWaitForTransactionReceipt: ({ hash }: { hash?: Hex }) => {
    m.receiptHash(hash)
    return { data: undefined, isLoading: false, isSuccess: false, error: null, ...m.receipt }
  },
}))

vi.mock("@/config/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn() } }))

function payout(value: bigint): Log {
  const topics = encodeEventTopics({
    abi: safeTokenEventsAbi,
    eventName: "Transfer",
    args: { from: merkleDrop, to: TEST_ACCOUNTS.user },
  })
  return {
    address: token,
    topics: topics as Log["topics"],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  }
}

describe("useClaimStep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.simulate.mockResolvedValue({})
    m.writeState = {}
    m.sendState = {}
    m.callsStatus = undefined
    m.capabilities = undefined
    m.receipt = {}
  })

  it("simulates the claim, then sends it with writeContract when the wallet does not batch", async () => {
    const { result } = renderHook(() => useClaimStep())

    await act(() => result.current.claim(INPUT))

    const call = {
      address: merkleDrop,
      abi: merkleDropAbi,
      functionName: "claim",
      args: [TEST_ACCOUNTS.user, 100n * SAFE, ROOT, PROOF],
    }
    expect(m.simulate).toHaveBeenCalledWith({ ...call, account: TEST_ACCOUNTS.user })
    expect(m.write).toHaveBeenCalledWith(call)
    expect(m.send).not.toHaveBeenCalled()
  })

  it("sends the claim as a batch of one in a wallet that batches", async () => {
    m.capabilities = { [activeChain.id]: { atomicBatch: { supported: true } } }
    const { result } = renderHook(() => useClaimStep())

    await act(() => result.current.claim(INPUT))

    expect(m.write).not.toHaveBeenCalled()
    const [{ calls }] = m.send.mock.calls[0] as [{ calls: { to: string; data: Hex }[] }]
    expect(calls).toHaveLength(1)
    expect(calls[0].to).toBe(merkleDrop)
    expect(decodeFunctionData({ abi: merkleDropAbi, data: calls[0].data })).toEqual({
      functionName: "claim",
      args: [TEST_ACCOUNTS.user, 100n * SAFE, ROOT, PROOF],
    })
  })

  it("stops before the wallet when the simulation reverts, and keeps the decodable revert", async () => {
    const revert = new Error(
      `Execution reverted with reason: custom error ${encodeErrorResult({ abi: merkleDropAbi, errorName: "MerkleRootWasUpdated" })}.`,
    )
    m.simulate.mockRejectedValue(revert)
    const { result } = renderHook(() => useClaimStep())

    await act(() => result.current.claim(INPUT))

    expect(m.write).not.toHaveBeenCalled()
    expect(m.send).not.toHaveBeenCalled()
    expect(result.current.error).toBe(revert)
    expect(revertedErrorName(result.current.error, merkleDropAbi)).toBe("MerkleRootWasUpdated")

    act(() => result.current.reset())
    expect(result.current.error).toBeNull()
    expect(m.writeReset).toHaveBeenCalled()
    expect(m.sendReset).toHaveBeenCalled()
  })

  it("reads the claimed amount from the receipt's transfer once confirmed", () => {
    m.writeState = { data: MOCK_TX_HASH, isSuccess: true }
    m.receipt = { isSuccess: true, data: { logs: [payout(37n * SAFE)] } }

    const { result } = renderHook(() => useClaimStep())

    expect(m.receiptHash).toHaveBeenCalledWith(MOCK_TX_HASH)
    expect(result.current.isSuccess).toBe(true)
    expect(result.current.isConfirmingTx).toBe(false)
    expect(result.current.claimedAmount).toBe(37n * SAFE)
  })

  it("is confirming while the receipt is pending, with no amount yet", () => {
    m.writeState = { data: MOCK_TX_HASH, isSuccess: true }
    m.receipt = { isLoading: true }

    const { result } = renderHook(() => useClaimStep())

    expect(result.current.isConfirmingTx).toBe(true)
    expect(result.current.claimedAmount).toBeUndefined()
  })

  it("waits on a batch until it executes, then follows the executed transaction's receipt", () => {
    m.sendState = { data: { id: "batch-1" } }
    m.callsStatus = { status: "pending" }
    const pending = renderHook(() => useClaimStep())
    expect(pending.result.current.isAwaitingExecution).toBe(true)
    expect(pending.result.current.isConfirmingTx).toBe(true)
    expect(m.receiptHash).toHaveBeenLastCalledWith(undefined)

    m.callsStatus = { status: "success", receipts: [{ transactionHash: EXECUTED_HASH }] }
    const executed = renderHook(() => useClaimStep())
    expect(executed.result.current.isAwaitingExecution).toBe(false)
    expect(m.receiptHash).toHaveBeenLastCalledWith(EXECUTED_HASH)
  })

  it("reports a batch that failed on chain as an error", () => {
    m.sendState = { data: { id: "batch-1" } }
    m.callsStatus = { status: "failure" }

    const { result } = renderHook(() => useClaimStep())

    expect(result.current.error?.message).toMatch(/reverted on chain/)
    expect(result.current.isConfirmingTx).toBe(false)
    expect(result.current.isAwaitingExecution).toBe(false)
  })
})
