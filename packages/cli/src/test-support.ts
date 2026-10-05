/**
 * Offline stand-ins for the chain and for SEF's files, so the commands run end to end in the
 * unit tests without a network. Every address and root here is made up, and derived from a
 * small number so no file in this package types one out.
 */
import { numberToHex, pad, type PublicClient } from "viem"
import { CONTRACTS, SEF_DATA, rewardProofUrl } from "@cobuilders/safenet-core"
import type { Context } from "./lib/index.js"
import type { Io, Runtime } from "./cli.js"

export const fakeAddress = (n: number | bigint) => pad(numberToHex(n), { size: 20 })
export const fakeRoot = (n: number) => pad(numberToHex(n), { size: 32 })

export const VALIDATOR_A = fakeAddress(0xa1)
export const VALIDATOR_B = fakeAddress(0xb2)
export const STAKER = fakeAddress(0x5)
export const OTHER_STAKER = fakeAddress(0x6)
export const ROOT = fakeRoot(0x1)
export const BLOCK = 26_000_000n
export const BLOCK_TIME = 1_790_000_000n
const SAFE = 10n ** 18n

export interface FakeOptions {
  readonly chainRoot?: string
  readonly proof?: object | null
  readonly githubStatus?: number
  /** Every RPC call rejects with this, to test the error path. */
  readonly rpcError?: Error
  /** eth_getLogs rejects, as the public endpoints do for historical ranges. */
  readonly logsRefused?: boolean
  /** Replaces SEF's rewards/latest.json or network-info.json, to test a changed shape. */
  readonly rewardsLatest?: object
  readonly networkInfo?: object
  /** A second staker opens a withdrawal with the id the first staker already claimed. */
  readonly sharedWithdrawalId?: boolean
}

function fakeClient(o: FakeOptions): PublicClient {
  const fail = () => {
    if (o.rpcError) throw o.rpcError
  }
  const reads: Record<string, (args: readonly unknown[]) => unknown> = {
    totalStakedAmount: () => 300n * SAFE,
    totalPendingWithdrawals: () => (o.sharedWithdrawalId ? 11n : 7n) * SAFE,
    merkleRoot: () => o.chainRoot ?? ROOT,
    balanceOf: () => 40n * SAFE,
    isValidator: ([a]) => a === VALIDATOR_A || a === VALIDATOR_B,
    totalValidatorStakes: ([a]) => (a === VALIDATOR_A ? 200n * SAFE : 100n * SAFE),
    stakes: () => 1n * SAFE,
    cumulativeClaimed: () => 10n * SAFE,
    getPendingWithdrawals: () => [
      { amount: 5n * SAFE, claimableAt: BLOCK_TIME - 60n },
      { amount: 2n * SAFE, claimableAt: BLOCK_TIME + 90_000n },
    ],
  }
  const log = (args: Record<string, unknown>, i: number) => ({
    args, blockNumber: BLOCK - BigInt(i), logIndex: 0, transactionHash: fakeRoot(0x100 + i),
  })
  const client = {
    getBlockNumber: async () => (fail(), BLOCK),
    getBlock: async (p?: { blockNumber?: bigint }) => {
      fail()
      const n = p?.blockNumber ?? BLOCK
      return { number: n, timestamp: BLOCK_TIME - (BLOCK - n) * 12n }
    },
    readContract: async (p: { functionName: string; args?: readonly unknown[] }) => {
      fail()
      const read = reads[p.functionName]
      if (!read) throw new Error(`fake chain: no ${p.functionName}`)
      return read(p.args ?? [])
    },
    getLogs: async (p: { event: { name: string }; fromBlock: bigint }) => {
      fail()
      if (o.logsRefused) throw new Error("archive requests require a personal token")
      // Logs come back for a scan's first range only, which starts at the deploy block, so a
      // scan over many ranges sees each log once.
      if (p.fromBlock !== CONTRACTS.staking.deployBlock && p.fromBlock !== CONTRACTS.merkleDrop.deployBlock) return []
      switch (p.event.name) {
        case "StakeIncreased": return [log({ staker: STAKER, validator: VALIDATOR_A, amount: SAFE }, 0)]
        case "WithdrawalInitiated": return [
          log({ staker: STAKER, validator: VALIDATOR_A, withdrawalId: 1n, amount: 7n * SAFE }, 1),
          log({ staker: STAKER, validator: VALIDATOR_A, withdrawalId: 2n, amount: 3n * SAFE }, 2),
          ...(o.sharedWithdrawalId
            ? [log({ staker: OTHER_STAKER, validator: VALIDATOR_A, withdrawalId: 2n, amount: 4n * SAFE }, 6)]
            : []),
        ]
        case "WithdrawalClaimed": return [log({ staker: STAKER, withdrawalId: 2n, amount: 3n * SAFE }, 3)]
        case "Claimed": return [log({ account: STAKER, amount: 4n * SAFE }, 4), log({ account: STAKER, amount: 6n * SAFE }, 5)]
        default: return []
      }
    },
  }
  return client as unknown as PublicClient
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export const SEF_VALIDATORS = [
  { address: VALIDATOR_A, commission: 0.05, is_active: true, label: "Alpha", participation_rate_14d: 0.9765 },
  { address: VALIDATOR_B, commission: 0.05, is_active: false, label: "Beta", participation_rate_14d: 0.99996 },
]

export const PUBLISHED_AT = "2026-10-04T21:12:45Z"

function fakeFetch(o: FakeOptions): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url === SEF_DATA.validatorInfoCommits) {
      if (o.githubStatus && o.githubStatus !== 200) return json({ message: "rate limited" }, o.githubStatus)
      return json([{ sha: "abcdef0123456789", commit: { committer: { date: PUBLISHED_AT } } }])
    }
    if (url === SEF_DATA.validatorInfo || url.endsWith("/validator-info.json")) return json(SEF_VALIDATORS)
    if (url === SEF_DATA.networkInfo && o.networkInfo) return json(o.networkInfo)
    if (url === SEF_DATA.rewardsLatest && o.rewardsLatest) return json(o.rewardsLatest)
    if (url === SEF_DATA.networkInfo) return json({ total_staked_amount: "300", total_transactions_checked: 1 })
    if (url === SEF_DATA.rewardsLatest) {
      return json({
        epoch: 0, merkleRoot: ROOT, rewardsUntil: "2026-09-22T00:00:00.000Z",
        tokenTotal: String(50n * SAFE), unpaidAmount: "0", updatedAt: "2026-09-22T08:55:44.268Z",
      })
    }
    if (url === rewardProofUrl(STAKER)) {
      if (o.proof === null) return new Response("404: Not Found", { status: 404 })
      return json(o.proof ?? { cumulativeAmount: String(12n * SAFE), kycAmount: "0", merkleRoot: ROOT, proof: [] })
    }
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

export function fakeContext(o: FakeOptions = {}): Context {
  return { client: fakeClient(o), fetch: fakeFetch(o), retryDelayMs: 0 }
}

/** A runtime that records what the program prints, against the fake chain. */
export function fakeRuntime(o: FakeOptions = {}): Runtime & { stdout: () => string; stderr: () => string } {
  let out = ""
  let err = ""
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t) }
  return {
    io,
    env: {},
    createContext: () => fakeContext(o),
    stdout: () => out,
    stderr: () => err,
  }
}
