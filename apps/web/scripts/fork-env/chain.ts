/**
 * The chain state behind the baseline, and the reads that prove it.
 *
 * Everything goes through viem against Anvil: cheat calls for the state, and eth_sendTransaction
 * as the accounts Anvil impersonates, whose keys nobody has. No address is written here. The
 * contracts come from core; the test account is derived from Anvil's public mnemonic.
 */
import {
  createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseEther,
  type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type Hex,
} from "viem"
import { mnemonicToAccount } from "viem/accounts"
import { mainnet } from "viem/chains"
import { CONTRACTS, merkleDropAbi } from "@cobuilders/safenet-core"
import { rpc } from "./processes"
import { ANVIL_URL, TEST_AMOUNT, TEST_BALANCE } from "./settings"

/**
 * Anvil's and Hardhat's public test mnemonic. Its keys are published, and its first account is
 * the wallet a tester imports. Anvil unlocks the same accounts, which the setup checks.
 */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"
export const testAccount = (): Address => mnemonicToAccount(ANVIL_MNEMONIC).address

const transport = http(ANVIL_URL)
export const chain = createPublicClient({ chain: mainnet, transport })
const test = createTestClient({ chain: mainnet, mode: "anvil", transport })
const wallet = createWalletClient({ chain: mainnet, transport })

const MERKLE_DROP = CONTRACTS.merkleDrop.address
const SAFE_TOKEN = CONTRACTS.safeToken.address
const STAKING = CONTRACTS.staking.address

/** Enough ETH for the setup transactions of an impersonated account. */
const GAS_MONEY = parseEther("10")

/** Sends a call as an impersonated account, and fails unless it succeeds. */
async function send<const abi extends Abi, name extends ContractFunctionName<abi, "nonpayable" | "payable">>(
  from: Address,
  call: { address: Address; abi: abi; functionName: name; args: ContractFunctionArgs<abi, "nonpayable" | "payable", name> },
): Promise<void> {
  // viem's generics cannot follow `call` through the spread; the constraint above keeps it sound.
  const hash = await wallet.writeContract({ ...call, account: from, chain: mainnet } as never)
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 })
  if (receipt.status !== "success") throw new Error(`${String(call.functionName)} reverted`)
}

export const safeBalance = (account: Address): Promise<bigint> =>
  chain.readContract({ address: SAFE_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account] })
export const merkleRoot = (): Promise<Hex> =>
  chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "merkleRoot" })
export const cumulativeClaimed = (account: Address): Promise<bigint> =>
  chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [account] })

export const snapshot = (): Promise<Hex> => test.snapshot()
/** Reverts to a snapshot. False when Anvil no longer has it: a revert consumes it, and so does a restart. */
export const revert = async (id: Hex): Promise<boolean> => (await rpc(ANVIL_URL, "evm_revert", [id])) === true

export interface Baseline {
  account: Address
  root: Hex
  /** What the wallet holds after the funding, in wei. */
  balance: bigint
  claimable: bigint
  snapshotId: Hex
}

/**
 * Puts the fork into the state a tester starts from: the new root on the MerkleDrop, the test
 * account funded with SAFE and free of its Mainnet EIP-7702 delegation, the MerkleDrop holding
 * the test amount on top of its balance, and a snapshot of all that to come back to.
 */
export async function establishBaseline(root: Hex): Promise<Baseline> {
  const account = testAccount()
  const [unlocked] = await wallet.getAddresses()
  if (unlocked?.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Anvil's first unlocked account is not the one derived from its public mnemonic")
  }

  // On Mainnet this address carries an EIP-7702 delegation. Cleared, so the wallet sends plain
  // transactions and the interface sees an externally owned account.
  await test.setCode({ address: account, bytecode: "0x" })

  const owner = await chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "owner" })
  for (const impersonated of [owner, STAKING]) {
    await test.impersonateAccount({ address: impersonated })
    await test.setBalance({ address: impersonated, value: GAS_MONEY })
  }
  await send(owner, { address: MERKLE_DROP, abi: merkleDropAbi, functionName: "setMerkleRoot", args: [root] })
  // The staking contract holds every staked SAFE: a real holder with more than enough.
  await send(STAKING, { address: SAFE_TOKEN, abi: erc20Abi, functionName: "transfer", args: [account, TEST_BALANCE] })
  await send(STAKING, { address: SAFE_TOKEN, abi: erc20Abi, functionName: "transfer", args: [MERKLE_DROP, TEST_AMOUNT] })
  for (const impersonated of [owner, STAKING]) await test.stopImpersonatingAccount({ address: impersonated })

  if ((await merkleRoot()).toLowerCase() !== root.toLowerCase()) throw new Error("the MerkleDrop does not report the new root")
  const claimed = await cumulativeClaimed(account)
  if (claimed !== 0n) throw new Error(`the test account has already claimed ${claimed} wei on Mainnet`)
  const balance = await safeBalance(account)
  if (balance < TEST_BALANCE) throw new Error("the test account did not receive its SAFE")

  const snapshotId = await snapshot()
  return { account, root, balance, claimable: TEST_AMOUNT, snapshotId }
}
