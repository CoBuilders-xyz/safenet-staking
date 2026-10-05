/**
 * The fork suite's access to Anvil: reads that assert on-chain state, and the cheat calls that
 * set a test up. The same technique as apps/web/e2e/fork/chain.ts, kept here so this suite owns
 * its Anvil and its port.
 *
 * No address is written here. Contracts come from core, the test account from the public test
 * mnemonic, the validator and the rewards claimer from SEF's data at the commit pinned next to
 * the fork block.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi as standardErc20Abi,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem"
import { mainnet } from "viem/chains"
import {
  CONTRACTS, MAINNET_FORK, MAINNET_FORK_SEF_DATA, SEF_DATA, erc20Abi, merkleDropAbi, stakingAbi, type SefValidator,
} from "@cobuilders/safenet-core"
import type { Signer } from "../lib/index.js"

export const STAKING = CONTRACTS.staking.address
export const SAFE_TOKEN = CONTRACTS.safeToken.address
export const MERKLE_DROP = CONTRACTS.merkleDrop.address

export function forkClients(url: string) {
  const transport = http(url)
  return {
    chain: createPublicClient({ chain: mainnet, transport, pollingInterval: 100 }) as PublicClient,
    test: createTestClient({ chain: mainnet, mode: "anvil", transport }),
    wallet: createWalletClient({ chain: mainnet, transport }),
  }
}
export type ForkClients = ReturnType<typeof forkClients>

/**
 * A signer for an account Anvil impersonates. It sends through eth_sendTransaction, so the node
 * signs: how the suite claims as an address whose key nobody has. The CLI has no such signer.
 */
export function impersonatedSigner(c: ForkClients, address: Address): Signer {
  return {
    address,
    send: (tx) => c.wallet.sendTransaction({ account: address, chain: mainnet, to: tx.to, data: tx.data, gas: tx.gas }),
  }
}

export async function impersonate(c: ForkClients, account: Address): Promise<void> {
  await c.test.impersonateAccount({ address: account })
  await c.test.setBalance({ address: account, value: parseEther("100") })
}

/**
 * Give `to` SAFE by moving it from a real holder: the MerkleDrop, which keeps the whole unclaimed
 * rewards balance. The suite takes far less than it holds beyond the claim it tests.
 */
export async function fundSafe(c: ForkClients, to: Address, value: bigint): Promise<void> {
  await impersonate(c, MERKLE_DROP)
  const hash = await c.wallet.writeContract({
    account: MERKLE_DROP, chain: mainnet, address: SAFE_TOKEN, abi: standardErc20Abi, functionName: "transfer", args: [to, value],
  })
  // Anvil mines at once. A wait longer than this is Anvil stalled on the archive endpoint, which
  // it waits 45 s on per request and retries; fail with that said, not at the test's timeout.
  const receipt = await c.chain.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch((err: unknown) => {
    throw new Error("Anvil did not mine the funding transfer within 60 s; it is likely waiting on the archive endpoint", { cause: err })
  })
  if (receipt.status !== "success") throw new Error("funding the test account with SAFE reverted")
  await c.test.stopImpersonatingAccount({ address: MERKLE_DROP })
}

export const safeBalance = (c: ForkClients, account: Address) =>
  c.chain.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account] })
export const allowance = (c: ForkClients, owner: Address) =>
  c.chain.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "allowance", args: [owner, STAKING] })
export const stakeOf = (c: ForkClients, staker: Address, validator: Address) =>
  c.chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "stakes", args: [staker, validator] })
export const pending = (c: ForkClients, staker: Address) =>
  c.chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "getPendingWithdrawals", args: [staker] })
export const claimed = (c: ForkClients, account: Address) =>
  c.chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [account] })
export const withdrawDelay = (c: ForkClients) =>
  c.chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "withdrawDelay" })

/** Move the chain's clock forward and mine a block at the new time. */
export async function warp(c: ForkClients, seconds: bigint): Promise<void> {
  await c.test.increaseTime({ seconds: Number(seconds) })
  await c.test.mine({ blocks: 1 })
}

/**
 * fetch, with SEF's proof files read at the commit pinned next to the fork block. SEF rewrites
 * them on `main` with every new root; read at the commit, they match the fork's root forever.
 */
export const pinnedFetch: typeof fetch = (input, init) => {
  const url = String(input)
  const pinned = url.startsWith(SEF_DATA.rewardsProofBase)
    ? MAINNET_FORK_SEF_DATA.rewardsProofBase + url.slice(SEF_DATA.rewardsProofBase.length)
    : url
  return fetch(pinned, init)
}

/** The first validator SEF lists as active that the staking contract accepts, in SEF's order. */
export async function activeValidator(c: ForkClients): Promise<Address> {
  const listed = (await fetchJson(MAINNET_FORK_SEF_DATA.validatorInfo)) as SefValidator[]
  for (const v of listed) {
    if (!v.is_active) continue
    const address = getAddress(v.address)
    if (await c.chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "isValidator", args: [address] })) {
      return address
    }
  }
  throw new Error("no validator is active in SEF's pinned list and registered on chain at the fork block")
}

export interface RewardsClaimer {
  readonly account: Address
  /** What a claim pays: the proof's cumulative amount less what was already claimed. */
  readonly claimable: bigint
}

/**
 * An externally owned address with something to claim at the fork block, whose proof carries the
 * MerkleDrop's root and holds nothing back pending compliance: the first in path order of SEF's
 * proof directory at the pinned commit. Deterministic: the block and the commit are both pinned.
 *
 * The directory is listed with one GitHub API request and the files are read in parallel. What
 * each address has claimed is read in one multicall at the fork block, from the archive endpoint
 * itself rather than through Anvil, which would fetch each slot from it one request at a time and
 * can be throttled into stalling.
 */
export async function findRewardsClaimer(archiveUrl: string): Promise<RewardsClaimer> {
  const archive = createPublicClient({ chain: mainnet, transport: http(archiveUrl), batch: { multicall: true } })
  const blockNumber = MAINNET_FORK.blockNumber
  const root = await archive.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber })
  const token = process.env.GITHUB_TOKEN
  const tree = (await fetchJson(MAINNET_FORK_SEF_DATA.proofTree, token ? { authorization: `Bearer ${token}` } : {})) as {
    truncated: boolean
    tree: { path: string; type: string }[]
  }
  if (tree.truncated) throw new Error("GitHub truncated the proof listing; walk it per directory instead")
  const paths = tree.tree.filter((e) => e.type === "blob" && e.path.endsWith(".json")).map((e) => e.path).sort()

  const proofs: { account: Address; cumulative: bigint }[] = []
  for (let i = 0; i < paths.length; i += 25) {
    const batch = await Promise.all(paths.slice(i, i + 25).map(async (path) => {
      const proof = (await fetchJson(`${MAINNET_FORK_SEF_DATA.rewardsProofBase}/proofs/${path}`)) as {
        cumulativeAmount: string; merkleRoot: Hex; proof: Hex[] | null; kycAmount?: string | null; kyc?: boolean | null
      }
      if (proof.merkleRoot.toLowerCase() !== root.toLowerCase() || !proof.proof) return null
      if (proof.kycAmount && proof.kycAmount !== "0" && proof.kyc !== true) return null
      return { account: getAddress(path.slice(path.lastIndexOf("/") + 1, -".json".length)), cumulative: BigInt(proof.cumulativeAmount) }
    }))
    proofs.push(...batch.filter((p) => p !== null))
  }
  const claimedSoFar = await Promise.all(proofs.map((p) =>
    archive.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [p.account], blockNumber })))
  for (const [i, p] of proofs.entries()) {
    const claimable = p.cumulative - claimedSoFar[i]!
    if (claimable <= 0n) continue
    if (await archive.getCode({ address: p.account, blockNumber })) continue
    return { account: p.account, claimable }
  }
  throw new Error(
    "no externally owned address has an unclaimed reward at the fork block in SEF's proofs at the pinned commit. " +
      "MAINNET_FORK in packages/core pins the block and the commit together; move them together.",
  )
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`)
  return res.json()
}
