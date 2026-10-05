/**
 * Node-side access to the Anvil fork: reads that assert on-chain state, and the cheat calls
 * that set a test up (balances, impersonation, time).
 *
 * No address is written here. Contracts come from @cobuilders/safenet-core, the test account
 * from Anvil's own unlocked accounts, the validator and the rewards claimer from SEF's data at
 * the commit pinned next to the fork block.
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  parseEther,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from "viem"
import { mainnet } from "viem/chains"
import {
  CONTRACTS,
  MAINNET_FORK_SEF_DATA,
  merkleDropAbi,
  type SefValidator,
} from "@cobuilders/safenet-core"
import { stakingAbi } from "../../src/abi/stakingAbi"
import { ANVIL_PORT } from "../ports"

export const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`

const transport = http(ANVIL_URL)
export const chain = createPublicClient({ chain: mainnet, transport })
const testClient = createTestClient({ chain: mainnet, mode: "anvil", transport })
const wallet = createWalletClient({ chain: mainnet, transport })

export const STAKING = CONTRACTS.staking.address
export const SAFE_TOKEN = CONTRACTS.safeToken.address
export const MERKLE_DROP = CONTRACTS.merkleDrop.address
export { stakingAbi, merkleDropAbi }

/** Enough ETH for any number of transactions in one test. */
const GAS_MONEY = parseEther("100")

/** The first of Anvil's unlocked default accounts. Anvil signs for it; the page holds no key. */
export async function defaultAccount(): Promise<Address> {
  const [account] = await wallet.getAddresses()
  if (!account) throw new Error("Anvil reports no unlocked accounts")
  return account
}

export async function snapshot(): Promise<Hex> {
  return testClient.snapshot()
}

export async function revert(id: Hex): Promise<void> {
  await testClient.revert({ id })
}

export async function fundGas(account: Address): Promise<void> {
  await testClient.setBalance({ address: account, value: GAS_MONEY })
}

/** Let the page send transactions as `account` without its key. */
export async function impersonate(account: Address): Promise<void> {
  await testClient.impersonateAccount({ address: account })
  await fundGas(account)
}

export async function stopImpersonating(account: Address): Promise<void> {
  await testClient.stopImpersonatingAccount({ address: account })
}

/** Send a contract call as an unlocked or impersonated account, and fail unless it succeeds. */
export async function send<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(
  from: Address,
  call: {
    address: Address
    abi: abi
    functionName: name
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>
  },
): Promise<void> {
  // viem's generics cannot follow `call` through the spread; the constraint above keeps it sound.
  const hash = await wallet.writeContract({ ...call, account: from, chain: mainnet } as never)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`${String(call.functionName)} reverted`)
}

/**
 * Give `to` SAFE by moving it from a real holder. The holder is the MerkleDrop, which keeps the
 * whole unclaimed rewards balance. Each test reverts its snapshot, so no other test sees it.
 */
export async function fundSafe(to: Address, amount: bigint): Promise<void> {
  const held = await safeBalance(MERKLE_DROP)
  if (held < amount) throw new Error(`the MerkleDrop holds ${held} SAFE wei, less than the ${amount} asked for`)
  await impersonate(MERKLE_DROP)
  await send(MERKLE_DROP, { address: SAFE_TOKEN, abi: erc20Abi, functionName: "transfer", args: [to, amount] })
  await stopImpersonating(MERKLE_DROP)
}

export async function safeBalance(account: Address): Promise<bigint> {
  return chain.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account] })
}

export async function allowance(owner: Address): Promise<bigint> {
  return chain.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "allowance", args: [owner, STAKING] })
}

/** Approve and stake directly, for tests whose subject comes after the stake. */
export async function stakeDirectly(account: Address, validator: Address, amount: bigint): Promise<void> {
  await send(account, { address: SAFE_TOKEN, abi: erc20Abi, functionName: "approve", args: [STAKING, amount] })
  await send(account, { address: STAKING, abi: stakingAbi, functionName: "stake", args: [validator, amount] })
}

export async function stakeOf(account: Address, validator: Address): Promise<bigint> {
  return chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "stakes", args: [account, validator] })
}

export async function pendingWithdrawals(account: Address) {
  return chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "getPendingWithdrawals", args: [account] })
}

/** Seconds since the epoch, by the latest block. Anvil's clock starts at the fork block, not now. */
export async function chainTime(): Promise<bigint> {
  return (await chain.getBlock()).timestamp
}

/** Move the chain's clock forward and mine a block at the new time. */
export async function warp(seconds: bigint): Promise<void> {
  await testClient.increaseTime({ seconds: Number(seconds) })
  await testClient.mine({ blocks: 1 })
}

/**
 * The first validator SEF lists as active that the staking contract also accepts, in SEF's
 * order. Deterministic: both sources are pinned.
 */
export async function activeValidator(): Promise<SefValidator> {
  const listed = (await fetchJson(MAINNET_FORK_SEF_DATA.validatorInfo)) as SefValidator[]
  for (const v of listed) {
    if (!v.is_active) continue
    const registered = await chain.readContract({
      address: STAKING,
      abi: stakingAbi,
      functionName: "isValidator",
      args: [getAddress(v.address)],
    })
    if (registered) return v
  }
  throw new Error("no validator is active in SEF's pinned list and registered on chain at the fork block")
}

/** The fields of SEF's proof file the claim needs. The app's RewardProof type has the rest. */
export interface ProofFile {
  cumulativeAmount: string
  merkleRoot: Hex
  proof: Hex[] | null
  kycAmount?: string | null
  kyc?: boolean | null
}

export interface RewardsClaimer {
  account: Address
  proof: ProofFile & { proof: Hex[] }
  /** What the claim pays out: the cumulative amount less what was already claimed. */
  claimable: bigint
}

/**
 * An address with something to claim at the fork block: SEF's proof file for it carries the
 * root the MerkleDrop holds, nothing is held back pending compliance, and its cumulative amount
 * exceeds what it has claimed. Externally owned, so the claim is sent as a wallet would send it.
 *
 * Found by listing SEF's proof directory at the pinned commit, one GitHub API request, and
 * trying the files in path order. Deterministic: the block and the commit are both pinned.
 */
export async function findRewardsClaimer(): Promise<RewardsClaimer> {
  const root = await chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "merkleRoot" })
  const tree = (await fetchJson(MAINNET_FORK_SEF_DATA.proofTree, githubHeaders())) as {
    truncated: boolean
    tree: { path: string; type: string }[]
  }
  if (tree.truncated) throw new Error("GitHub truncated the proof listing; walk it per directory instead")
  const files = tree.tree.filter((e) => e.type === "blob" && e.path.endsWith(".json")).map((e) => e.path).sort()

  let rootSeen = false
  for (const path of files) {
    const proof = (await fetchJson(`${MAINNET_FORK_SEF_DATA.rewardsProofBase}/proofs/${path}`)) as ProofFile
    if (proof.merkleRoot.toLowerCase() !== root.toLowerCase()) continue
    rootSeen = true
    if (!proof.proof || (proof.kycAmount && proof.kycAmount !== "0" && proof.kyc !== true)) continue
    const account = getAddress(path.slice(path.lastIndexOf("/") + 1, -".json".length))
    if (await chain.getCode({ address: account })) continue
    const claimed = await chain.readContract({
      address: MERKLE_DROP,
      abi: merkleDropAbi,
      functionName: "cumulativeClaimed",
      args: [account],
    })
    const claimable = BigInt(proof.cumulativeAmount) - claimed
    if (claimable > 0n) return { account, proof: { ...proof, proof: proof.proof }, claimable }
  }
  throw new Error(
    rootSeen
      ? "no externally owned address has an unclaimed reward at the fork block"
      : "no proof file at the pinned SEF commit carries the root on chain at the fork block. " +
          "MAINNET_FORK in packages/core pins the block and the commit together; move them together.",
  )
}

/** CI passes its token, so the one API request does not share the runner IP's anonymous limit. */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`)
  return res.json()
}
