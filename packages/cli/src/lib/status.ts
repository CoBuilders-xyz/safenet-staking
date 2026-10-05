/** `safenet status`: network totals, each with its source. */
import type { Hex } from "viem"
import { CONTRACTS, erc20Abi, merkleDropAbi, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { figure, sameHex, type Figure } from "./figure.js"
import { fetchNetworkInfo, fetchRewardsLatest, fetchValidators, parseSefAmount, parseWei } from "./sef.js"

export interface NetworkStatus {
  readonly block: bigint
  readonly totalStaked: Figure<bigint>
  /** SEF's snapshot. It can lag the chain by up to three hours, which is not disagreement. */
  readonly totalStakedPublished: Figure<bigint>
  readonly activeValidators: Figure<number>
  readonly registeredValidators: Figure<{ registered: number; listed: number }>
  readonly pendingWithdrawals: Figure<bigint>
  readonly rewardsAllocated: Figure<bigint>
  readonly rewardsEpoch: Figure<{ epoch: number; rewardsUntil: string; updatedAt: string }>
  /** What the MerkleDrop still holds: allocated and not yet claimed. */
  readonly rewardsUnclaimed: Figure<bigint>
  readonly merkleRoot: {
    readonly onChain: Figure<Hex>
    readonly published: Figure<string>
    readonly match: boolean
  }
}

export async function getStatus(ctx: Context): Promise<NetworkStatus> {
  const { client } = ctx
  const staking = CONTRACTS.staking.address
  const merkleDrop = CONTRACTS.merkleDrop.address
  // Every chain read is pinned to one block, so the figures describe one instant.
  const [blockNumber, validators, latest, network] = await Promise.all([
    client.getBlockNumber(),
    fetchValidators(ctx),
    fetchRewardsLatest(ctx),
    fetchNetworkInfo(ctx),
  ])
  const [totalStaked, pending, root, unclaimed, registered] = await Promise.all([
    client.readContract({ address: staking, abi: stakingAbi, functionName: "totalStakedAmount", blockNumber }),
    client.readContract({ address: staking, abi: stakingAbi, functionName: "totalPendingWithdrawals", blockNumber }),
    client.readContract({ address: merkleDrop, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber }),
    client.readContract({
      address: CONTRACTS.safeToken.address, abi: erc20Abi, functionName: "balanceOf", args: [merkleDrop], blockNumber,
    }),
    Promise.all(
      validators.map((v) =>
        client.readContract({
          address: staking, abi: stakingAbi, functionName: "isValidator", args: [v.address as Hex], blockNumber,
        }),
      ),
    ),
  ])

  return {
    block: blockNumber,
    totalStaked: figure(totalStaked, "chain: Staking.totalStakedAmount()"),
    totalStakedPublished: figure(
      parseSefAmount(network.total_staked_amount, "SEF's total_staked_amount"),
      "SEF: network-info.json total_staked_amount, a snapshot published every 3 hours",
    ),
    activeValidators: figure(
      validators.filter((v) => v.is_active).length,
      "SEF: validator-info.json is_active",
    ),
    registeredValidators: figure(
      { registered: registered.filter(Boolean).length, listed: validators.length },
      "chain: Staking.isValidator() for each address in SEF's validator-info.json",
    ),
    pendingWithdrawals: figure(pending, "chain: Staking.totalPendingWithdrawals()"),
    rewardsAllocated: figure(parseWei(latest.tokenTotal, "SEF's tokenTotal"), "SEF: rewards/latest.json tokenTotal"),
    rewardsEpoch: figure(
      { epoch: latest.epoch, rewardsUntil: latest.rewardsUntil, updatedAt: latest.updatedAt },
      "SEF: rewards/latest.json epoch, rewardsUntil, updatedAt",
    ),
    rewardsUnclaimed: figure(unclaimed, "chain: SAFE.balanceOf(MerkleDrop)"),
    merkleRoot: {
      onChain: figure(root, "chain: MerkleDrop.merkleRoot()"),
      published: figure(latest.merkleRoot, "SEF: rewards/latest.json merkleRoot"),
      match: sameHex(root, latest.merkleRoot),
    },
  }
}
