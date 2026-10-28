/**
 * Offline stand-ins for the chain and for SEF's files, so the commands run end to end in the
 * unit tests without a network. Every address and root here is made up, and derived from a
 * small number so no file in this package types one out.
 */
import {
  ContractFunctionRevertedError, HttpRequestError, WaitForTransactionReceiptTimeoutError, decodeFunctionData, encodeAbiParameters,
  encodeErrorResult, encodeEventTopics, encodeFunctionResult, numberToHex, pad,
  type Abi, type Hex, type PublicClient,
} from "viem"
import { mainnet } from "viem/chains"
import {
  ANVIL_TEST_MNEMONIC, CONTRACTS, REWARDS_LATEST_PATH, SUBGRAPH_ENDPOINTS, SEF_DATA, ensResolverAbi, ensUniversalResolverAbi, rewardProofPath,
  rewardProofUrl, safeTokenEventsAbi,
} from "@cobuilders/safenet-core"
import type { Context, Signer } from "./lib/index.js"
import type { Io, Runtime } from "./cli.js"
import { loadSigner } from "./commands/signer.js"
import type { SignerRequest } from "./commands/signer.js"

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
  /** The message eth_getLogs rejects with when `logsRefused` is set. */
  readonly rpcErrorText?: string
  /** Replaces SEF's rewards/latest.json, network-info.json or validator-info.json, to test a changed shape. */
  readonly rewardsLatest?: object
  readonly networkInfo?: object
  readonly validatorInfo?: readonly object[]
  /** A second staker opens a withdrawal with the id the first staker already claimed. */
  readonly sharedWithdrawalId?: boolean
  /** eth_call of this function reverts with this custom error from the call's ABI. */
  readonly revert?: { readonly functionName: string; readonly errorName: string }
  /** The SAFE allowance the staker gave the staking contract. */
  readonly allowance?: bigint
  /** The environment the program sees, for the signer options. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** What a claim's SAFE transfer pays. Defaults to CLAIMABLE, the proof's claimable amount. */
  readonly paid?: bigint
  /** eth_sendRawTransaction fails, as when the node's answer is lost. */
  readonly broadcastError?: boolean
  /** Waiting for a receipt times out, as viem reports it. */
  readonly receiptTimeout?: boolean
  /** The address SEF publishes a proof for. Defaults to STAKER. */
  readonly proofAccount?: Hex
  /** Replaces how the program loads a signer. */
  readonly loadSigner?: (request: SignerRequest, ctx: Context) => Promise<Signer>
  /** The contenthash of SEF's ENS name. Empty, as on Mainnet on 2026-10-07, when unset. */
  readonly ensContenthash?: Hex
  /** IPFS gateway hosts that answer 502. Every other gateway serves the dataset. */
  readonly failingGateways?: readonly string[]
  /** Every gateway answers, and the dataset has no file at the expected paths: a layout mismatch. */
  readonly datasetMissing?: boolean
  /** The status the repository answers for its reward files, when not 200. */
  readonly repositoryStatus?: number
  /** Subgraph failure, mismatch, or two claims tied by block number in reversed event order. */
  readonly subgraph?: "down" | "differs" | "same-block-reversed"
}

/** A made-up ENS resolver. */
export const ENS_RESOLVER = fakeAddress(0xe75)
/** The dataset's latest.json carries this epoch, the repository's 0, so a test sees which answered. */
export const DATASET_EPOCH = 1

/** What the fake chain was asked to do that a dry run must never ask. */
export interface SendLog {
  prepared: number
  broadcast: number
}

export const CLAIMABLE = 2n * 10n ** 18n
export const WITHDRAWAL_DELAY = 172_800n
export const TX_HASH = fakeRoot(0xfeed)

/** Anvil's public test mnemonic, as core pins it. */
export const TEST_MNEMONIC = ANVIL_TEST_MNEMONIC

/** The SAFE Transfer a claim emits, shaped as a log, so the code that reads it is tested too. */
function transferLog(to: Hex, value: bigint) {
  return {
    address: CONTRACTS.safeToken.address,
    topics: encodeEventTopics({ abi: safeTokenEventsAbi, eventName: "Transfer", args: { from: CONTRACTS.merkleDrop.address, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  }
}

function fakeClient(o: FakeOptions, sends: SendLog): PublicClient {
  const fail = () => {
    if (o.rpcError) throw o.rpcError
  }
  const reads: Record<string, (args: readonly unknown[], blockNumber?: bigint) => unknown> = {
    totalStakedAmount: () => 300n * SAFE,
    totalPendingWithdrawals: () => (o.sharedWithdrawalId ? 11n : 7n) * SAFE,
    merkleRoot: () => o.chainRoot ?? ROOT,
    balanceOf: () => 40n * SAFE,
    isValidator: ([a]) => [VALIDATOR_A, VALIDATOR_B].includes(String(a).toLowerCase() as Hex),
    totalValidatorStakes: ([a]) => (a === VALIDATOR_A ? 200n * SAFE : 100n * SAFE),
    stakes: () => 1n * SAFE,
    // The two Claimed logs below: 6 SAFE at BLOCK - 5, then 4 SAFE at BLOCK - 4.
    cumulativeClaimed: (_, b) => (b === undefined || b >= BLOCK - 4n ? 10n * SAFE : b >= BLOCK - 5n && o.subgraph !== "same-block-reversed" ? 6n * SAFE : 0n),
    getPendingWithdrawals: () => [
      { amount: 5n * SAFE, claimableAt: BLOCK_TIME - 60n },
      { amount: 2n * SAFE, claimableAt: BLOCK_TIME + 90_000n },
    ],
    allowance: () => o.allowance ?? 0n,
    withdrawDelay: () => WITHDRAWAL_DELAY,
    // The same two withdrawals as getPendingWithdrawals, as the linked list the contract keeps.
    withdrawalQueues: () => [1n, 2n],
    withdrawalNodes: ([, id]) =>
      id === 1n ? [5n * SAFE, BLOCK_TIME - 60n, 0n, 2n] : [2n * SAFE, BLOCK_TIME + 90_000n, 1n, 0n],
  }
  let lastSent: { to: Hex; account: { address: Hex } } | undefined
  const receiptFor = () => ({
    status: "success",
    blockNumber: BLOCK + 1n,
    gasUsed: 45_000n,
    logs: lastSent?.to === CONTRACTS.merkleDrop.address ? [transferLog(lastSent.account.address, o.paid ?? CLAIMABLE)] : [],
  })
  /** eth_call: reverts as `o.revert` says, the way viem reports a revert. */
  const simulate = (p: { abi: Abi; functionName: string }) => {
    if (o.revert && o.revert.functionName === p.functionName) {
      throw new ContractFunctionRevertedError({
        abi: p.abi,
        data: encodeErrorResult({ abi: p.abi, errorName: o.revert.errorName } as never),
        functionName: p.functionName,
      })
    }
  }
  const log = (args: Record<string, unknown>, i: number) => ({
    args, blockNumber: BLOCK - BigInt(i), logIndex: 0, transactionHash: fakeRoot(0x100 + i),
  })
  const client = {
    chain: { id: 1 },
    getChainId: async () => 1,
    simulateContract: async (p: { abi: Abi; functionName: string }) => (fail(), simulate(p), { result: undefined }),
    estimateContractGas: async () => (fail(), 50_000n),
    simulateBlocks: async (p: { blocks: { calls: { abi: Abi; functionName: string; account: Hex }[] }[] }) => {
      fail()
      return [{
        calls: p.blocks[0]!.calls.map((c) => {
          try {
            simulate(c)
          } catch (error) {
            return { status: "failure", gasUsed: 21_000n, logs: [], error }
          }
          const logs = c.functionName === "claim" ? [transferLog(c.account, o.paid ?? CLAIMABLE)] : []
          return { status: "success", gasUsed: 60_000n, logs }
        }),
      }]
    },
    prepareTransactionRequest: async (p: { to: Hex; data: Hex; gas: bigint; account: { address: Hex } }) => {
      sends.prepared++
      lastSent = p
      return {
        to: p.to, data: p.data, gas: p.gas, chainId: 1, nonce: 0, type: "eip1559",
        maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
      }
    },
    sendRawTransaction: async () => {
      sends.broadcast++
      if (o.broadcastError) throw new HttpRequestError({ url: "https://archive.invalid/v2/not-a-real-key", status: 504 })
      return TX_HASH
    },
    // A claim's receipt carries the SAFE transfer it paid, as on chain.
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (o.receiptTimeout) throw new WaitForTransactionReceiptTimeoutError({ hash })
      return receiptFor()
    },
    getBlockNumber: async () => (fail(), BLOCK),
    getBlock: async (p?: { blockNumber?: bigint }) => {
      fail()
      const n = p?.blockNumber ?? BLOCK
      return { number: n, timestamp: BLOCK_TIME - (BLOCK - n) * 12n }
    },
    // SEF's ENS name, read with one plain eth_call: the Universal Resolver's resolve, carrying
    // contenthash(node), answered through a made-up resolver.
    request: async ({ method, params }: { method: string; params: [{ to: Hex; data: Hex }, string] }) => {
      fail()
      const [call] = params
      if (method !== "eth_call" || call.to !== mainnet.contracts.ensUniversalResolver.address) {
        throw new Error(`fake chain: no ${method} to ${call?.to}`)
      }
      const { functionName } = decodeFunctionData({ abi: ensUniversalResolverAbi, data: call.data })
      if (functionName !== "resolve") throw new Error(`fake chain: no ${functionName}`)
      const answer = encodeFunctionResult({ abi: ensResolverAbi, functionName: "contenthash", result: o.ensContenthash ?? "0x" })
      return encodeFunctionResult({ abi: ensUniversalResolverAbi, functionName: "resolve", result: [answer, ENS_RESOLVER] })
    },
    readContract: async (p: { functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
      fail()
      const read = reads[p.functionName]
      if (!read) throw new Error(`fake chain: no ${p.functionName}`)
      return read(p.args ?? [], p.blockNumber)
    },
    getLogs: async (p: { event: { name: string }; fromBlock: bigint }) => {
      fail()
      if (o.logsRefused) throw new Error(o.rpcErrorText ?? "archive requests require a personal token")
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
        case "Claimed": return [
          { ...log({ account: STAKER, amount: 4n * SAFE }, 4),
            ...(o.subgraph === "same-block-reversed" ? { logIndex: 2 } : {}) },
          { ...log({ account: STAKER, amount: 6n * SAFE }, 5),
            ...(o.subgraph === "same-block-reversed" ? { blockNumber: BLOCK - 4n } : {}) },
        ]
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

const latestFile = (epoch: number) => ({
  epoch, merkleRoot: ROOT, rewardsUntil: "2026-09-22T00:00:00.000Z",
  tokenTotal: String(50n * SAFE), unpaidAmount: "0",
})

/**
 * SEF's validator-info.json as published at cce3fc2, 2026-10-20 09:01 UTC, and live until 88bf9d9,
 * 2026-10-22 14:33 UTC: every rate null. Labels, flags and commissions copied from the file; the
 * addresses are this file's fixtures, in the same places.
 */
export const SEF_VALIDATORS_AT_CCE3FC2 = [
  { address: VALIDATOR_A, commission: 0.05, is_active: true, label: "Gnosis", participation_rate_14d: null },
  { address: VALIDATOR_B, commission: 0.05, is_active: false, label: "RockawayX", participation_rate_14d: null },
]

/**
 * SEF's rewards/latest.json as live on 2026-10-22, after 276526f removed `updatedAt`: the five
 * fields, values copied from the file, except the root, which is the fake chain's.
 */
export const SEF_LATEST_2026_10_22 = {
  epoch: 0, merkleRoot: ROOT, rewardsUntil: "2026-10-06T00:00:00.000Z",
  tokenTotal: "4499987774807670271201970", unpaidAmount: "12225192329728798030",
}

/** SEF's IPFS dataset through a gateway: the repository's layout under the dataset root. */
function fakeDataset(o: FakeOptions, url: URL): Response {
  if (o.failingGateways?.includes(url.host)) return new Response("bad gateway", { status: 502 })
  if (o.datasetMissing) return new Response("not found", { status: 404 })
  const path = url.pathname.split("/").slice(3).join("/")
  if (path === REWARDS_LATEST_PATH) return json(latestFile(DATASET_EPOCH))
  if (path === rewardProofPath(o.proofAccount ?? STAKER) && o.proof !== null) {
    return json(o.proof ?? { cumulativeAmount: String(12n * SAFE), kycAmount: "0", merkleRoot: ROOT, proof: [] })
  }
  return new Response("not found", { status: 404 })
}

/**
 * The Mainnet subgraph, consistent with the fake chain: two periods, the second current, and the
 * two claims of the Claimed logs, one in each.
 */
function fakeSubgraph(o: FakeOptions, body: string): Response {
  if (o.subgraph === "down") return new Response("bad gateway", { status: 502 })
  if (body.includes("_meta")) return json({ data: { _meta: { block: { number: Number(BLOCK), timestamp: null } } } })
  const period = (n: number, block: bigint) => ({
    period: n, root: fakeRoot(0x200 + n), blockNumber: String(block), timestamp: String(BLOCK_TIME - (BLOCK - block) * 12n),
    transactionHash: fakeRoot(0x300 + n),
  })
  const claims = [
    { blockNumber: String(o.subgraph === "same-block-reversed" ? BLOCK - 4n : BLOCK - 5n), amount: String(6n * SAFE), cumulativeAmount: String(6n * SAFE) },
    { blockNumber: String(BLOCK - 4n), amount: String(4n * SAFE), cumulativeAmount: String((o.subgraph === "differs" ? 9n : 10n) * SAFE) },
  ]
  return json({
    data: {
      rewardPeriods: [period(1, BLOCK - 10n), period(2, BLOCK - 4n)],
      rewardClaims: o.subgraph === "same-block-reversed" ? claims.reverse() : claims,
    },
  })
}

function fakeFetch(o: FakeOptions): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const parsed = new URL(url)
    if (url === SUBGRAPH_ENDPOINTS.mainnet) return fakeSubgraph(o, String(init?.body ?? ""))
    if (/^\/ip[fn]s\//.test(parsed.pathname)) return fakeDataset(o, parsed)
    if (o.repositoryStatus && url.startsWith(SEF_DATA.rewardsProofBase)) {
      return new Response("repository unavailable", { status: o.repositoryStatus })
    }
    if (url === SEF_DATA.validatorInfoCommits) {
      if (o.githubStatus && o.githubStatus !== 200) return json({ message: "rate limited" }, o.githubStatus)
      return json([{ sha: "abcdef0123456789", commit: { committer: { date: PUBLISHED_AT } } }])
    }
    if (url === SEF_DATA.validatorInfo || url.endsWith("/validator-info.json")) return json(o.validatorInfo ?? SEF_VALIDATORS)
    if (url === SEF_DATA.networkInfo && o.networkInfo) return json(o.networkInfo)
    if (url === SEF_DATA.rewardsLatest && o.rewardsLatest) return json(o.rewardsLatest)
    if (url === SEF_DATA.networkInfo) return json({ total_staked_amount: "300", total_transactions_checked: 1 })
    if (url === SEF_DATA.rewardsLatest) return json(latestFile(0))
    if (url === rewardProofUrl(o.proofAccount ?? STAKER)) {
      if (o.proof === null) return new Response("404: Not Found", { status: 404 })
      return json(o.proof ?? { cumulativeAmount: String(12n * SAFE), kycAmount: "0", merkleRoot: ROOT, proof: [] })
    }
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

export function fakeContext(o: FakeOptions = {}, sends: SendLog = { prepared: 0, broadcast: 0 }): Context {
  return { client: fakeClient(o, sends), fetch: fakeFetch(o), retryDelayMs: 0 }
}

/** A runtime that records what the program prints, against the fake chain. */
export function fakeRuntime(
  o: FakeOptions = {},
): Runtime & { stdout: () => string; stderr: () => string; sends: SendLog } {
  let out = ""
  let err = ""
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t) }
  const sends: SendLog = { prepared: 0, broadcast: 0 }
  const env = o.env ?? {}
  return {
    io,
    env,
    createContext: (options) => ({ ...fakeContext(o, sends), ipfsGateway: options.ipfsGateway, subgraphUrl: options.subgraphUrl }),
    loadSigner: o.loadSigner ?? ((request, ctx) => loadSigner(request, ctx, { env, askPassword: undefined })),
    stdout: () => out,
    stderr: () => err,
    sends,
  }
}
