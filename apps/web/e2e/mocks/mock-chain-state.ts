/**
 * Mutable "chain state" shared between the Node-side RPC mock (e2e/mocks/rpc-handler.ts)
 * and the browser-side injected wallet (e2e/mocks/ethereum-provider.ts).
 *
 * eth_call reads (balances, stakes, allowance, ...) are served by the Node-side
 * Playwright route handler, but eth_sendTransaction is answered entirely inside the
 * injected browser script and never touches that route. Without this bridge, a test
 * could click "Stake" and get a success toast, but every subsequent read would still
 * return the pre-transaction values. `page.exposeFunction` (wired up in base.fixture.ts)
 * lets the injected script report submitted transactions back into this same state
 * object, so reads reflect what was actually "sent" — e.g. an approve unlocks the
 * Stake button, a stake increases "Your Stake", a claim empties the withdrawal queue.
 */

import { encodeAbiParameters, encodeErrorResult, encodeEventTopics, type Hex } from "viem"
import { merkleDropAbi, safeTokenEventsAbi } from "@cobuilders/safenet-core"
import {
  AMOUNTS,
  VALIDATORS,
  TEST_USER,
  TEST_MERKLE_ROOT,
  MERKLE_DROP_BALANCE,
  REWARDS_LATEST,
  MERKLE_DROP_CONTRACT,
  TOKEN_CONTRACT,
  BLOCK_NUMBER,
} from "../fixtures/test-data"
import type { RewardProof } from "./rpc-responses"

/** A log as eth_getTransactionReceipt returns it. */
export interface RpcLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  blockHash: string
  transactionHash: string
  transactionIndex: string
  logIndex: string
  removed: boolean
}

export interface PendingWithdrawal {
  amount: bigint
  claimableAt: bigint
}

export interface MockChainState {
  balance: bigint
  allowance: bigint
  /** validator address (lowercase) -> staked amount */
  stakes: Map<string, bigint>
  /** FIFO queue, oldest first */
  pendingWithdrawals: PendingWithdrawal[]
  merkleDropClaimed: bigint
  /** undefined = no reward proof configured for this address (served as 404) */
  rewardProof?: RewardProof | null
  /** Root the MerkleDrop reports on chain (merkleRoot()) */
  merkleRoot: string
  /** SAFE the MerkleDrop holds (token balanceOf(merkleDrop)); a claim pays out of it */
  merkleDropBalance: bigint
  /** SEF's rewards/latest.json; null is served as a 404 */
  rewardsLatest: typeof REWARDS_LATEST | null
  /** When true, the next eth_sendTransaction simulates the user rejecting the wallet prompt. */
  rejectNextTx: boolean
  /** Logs of transactions that emitted any, by hash. Every other receipt has none. */
  receiptLogs: Map<string, RpcLog[]>
  /** Counts claims, so each gets its own transaction hash and its own receipt. */
  claims: number
}

export interface MockChainStateOverrides {
  balance?: bigint
  allowance?: bigint
  stakes?: Record<string, bigint>
  pendingWithdrawals?: PendingWithdrawal[]
  merkleDropClaimed?: bigint
  rewardProof?: RewardProof | null
  merkleRoot?: string
  merkleDropBalance?: bigint
  rewardsLatest?: typeof REWARDS_LATEST | null
}

export function createMockChainState(overrides: MockChainStateOverrides = {}): MockChainState {
  const stakes = new Map<string, bigint>([
    [VALIDATORS.validatorA.toLowerCase(), AMOUNTS.userStakeValidatorA],
    [VALIDATORS.validatorB.toLowerCase(), AMOUNTS.userStakeValidatorB],
  ])
  if (overrides.stakes) {
    for (const [validator, amount] of Object.entries(overrides.stakes)) {
      stakes.set(validator.toLowerCase(), amount)
    }
  }

  return {
    balance: overrides.balance ?? AMOUNTS.userBalance,
    allowance: overrides.allowance ?? AMOUNTS.unlimitedAllowance,
    stakes,
    pendingWithdrawals:
      overrides.pendingWithdrawals ??
      [{ amount: AMOUNTS.pendingWithdrawalAmount, claimableAt: BigInt(Math.floor(Date.now() / 1000) - 3600) }],
    merkleDropClaimed: overrides.merkleDropClaimed ?? 0n,
    rewardProof: overrides.rewardProof,
    merkleRoot: overrides.merkleRoot ?? TEST_MERKLE_ROOT,
    merkleDropBalance: overrides.merkleDropBalance ?? MERKLE_DROP_BALANCE,
    rewardsLatest: overrides.rewardsLatest === undefined ? { ...REWARDS_LATEST } : overrides.rewardsLatest,
    rejectNextTx: false,
    receiptLogs: new Map(),
    claims: 0,
  }
}

/** 4-byte selectors for the write methods the mock provider intercepts. */
export const TX_SELECTORS = {
  approve: "0x095ea7b3",
  stake: "0xadc9772e",
  initiateWithdrawal: "0xc8393ba9",
  claimWithdrawal: "0x6e66d84a",
  claim: "0x1d7d4ebc",
} as const

/** Read one 32-byte ABI word (as hex chars, no 0x) at the given word index of the params section. */
function word(params: string, index: number): string {
  return params.slice(index * 64, index * 64 + 64)
}

function wordToBigInt(params: string, index: number): bigint {
  return BigInt("0x" + (word(params, index) || "0"))
}

function wordToAddress(params: string, index: number): string {
  return "0x" + word(params, index).slice(24)
}

/**
 * What the MerkleDrop's `claim` would revert with for this calldata, mirroring the contract's
 * checks in the order the chain showed them: the root first, then the amount. The proof itself
 * is not checked; the mock trusts it. Undefined when the claim would succeed.
 */
export function claimRevert(state: MockChainState, data: string): Hex | undefined {
  const params = data.slice(10)
  const expectedRoot = "0x" + word(params, 2)
  if (expectedRoot.toLowerCase() !== state.merkleRoot.toLowerCase()) {
    return encodeErrorResult({ abi: merkleDropAbi, errorName: "MerkleRootWasUpdated" })
  }
  if (wordToBigInt(params, 1) <= state.merkleDropClaimed) {
    return encodeErrorResult({ abi: merkleDropAbi, errorName: "NothingToClaim" })
  }
  return undefined
}

/** The SAFE transfer a claim emits: from the MerkleDrop to the account, for what it paid. */
function claimTransferLog(txHash: string, to: string, value: bigint): RpcLog {
  return {
    address: TOKEN_CONTRACT,
    // Both indexed arguments are given, so every topic is a single value.
    topics: encodeEventTopics({
      abi: safeTokenEventsAbi,
      eventName: "Transfer",
      args: { from: MERKLE_DROP_CONTRACT as Hex, to: to as Hex },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: BLOCK_NUMBER,
    blockHash: "0x" + "bb".repeat(32),
    transactionHash: txHash,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  }
}

/**
 * Mutate `state` to reflect a submitted transaction, mirroring what the real
 * staking/token/MerkleDrop contracts would do. `data` is the full calldata
 * (selector + ABI-encoded params) as sent via eth_sendTransaction.
 *
 * Returns a transaction hash for a transaction whose receipt carries logs, so the wallet
 * mock can hand it out. Undefined for every other one, which keeps the shared mock hash.
 */
export function applyMockTx(state: MockChainState, data: string, userAddress: string = TEST_USER): string | undefined {
  const selector = data.slice(0, 10).toLowerCase()
  const params = data.slice(10)

  switch (selector) {
    case TX_SELECTORS.approve: {
      state.allowance = wordToBigInt(params, 1)
      break
    }
    case TX_SELECTORS.stake: {
      const validator = wordToAddress(params, 0).toLowerCase()
      const amount = wordToBigInt(params, 1)
      state.stakes.set(validator, (state.stakes.get(validator) ?? 0n) + amount)
      state.balance -= amount
      break
    }
    case TX_SELECTORS.initiateWithdrawal: {
      const validator = wordToAddress(params, 0).toLowerCase()
      const amount = wordToBigInt(params, 1)
      state.stakes.set(validator, (state.stakes.get(validator) ?? 0n) - amount)
      // Real contract locks the withdrawal for withdrawDelay before it's claimable.
      const claimableAt = BigInt(Math.floor(Date.now() / 1000)) + AMOUNTS.withdrawDelay
      state.pendingWithdrawals.push({ amount, claimableAt })
      break
    }
    case TX_SELECTORS.claimWithdrawal: {
      const claimed = state.pendingWithdrawals.shift()
      if (claimed) state.balance += claimed.amount
      break
    }
    case TX_SELECTORS.claim: {
      const account = wordToAddress(params, 0).toLowerCase()
      if (account !== userAddress.toLowerCase()) break
      if (claimRevert(state, data)) break
      const cumulativeAmount = wordToBigInt(params, 1)
      const delta = cumulativeAmount - state.merkleDropClaimed
      state.merkleDropClaimed = cumulativeAmount
      state.balance += delta
      state.merkleDropBalance -= delta
      state.claims += 1
      const txHash = "0x" + state.claims.toString(16).padStart(4, "0") + "c1".repeat(30)
      state.receiptLogs.set(txHash, [claimTransferLog(txHash, account, delta)])
      return txHash
    }
    default:
      break
  }
}
