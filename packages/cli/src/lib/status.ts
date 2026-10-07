/** `safenet status`: network totals, each with its source. */
import type { Hex } from "viem"
import { CONTRACTS, erc20Abi, merkleDropAbi, stakingAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { figure, sameHex, type Figure } from "./figure.js"
import {
  fetchNetworkInfo, fetchValidators, parseSefAmount, parseWei, readRewardsLatest, type RewardsSourceUsed,
} from "./sef.js"

export interface NetworkStatus {
  readonly block: bigint
  readonly totalStaked: Figure<bigint>
  /** SEF's snapshot. It can lag the chain by up to three hours, which is not disagreement. */
  readonly totalStakedPublished: Figure<bigint>
  readonly activeValidators: Figure<number>
  readonly registeredValidators: Figure<{ registered: number; listed: number }>
  readonly pendingWithdrawals: Figure<bigint>
  /**
   * tokenTotal, the allocation behind the published root. Null, with `reason`, when the root on
   * chain differs: then the contract does not pay out that allocation yet.
   */
  readonly rewardsAllocated: DerivedFigure
  readonly rewardsEpoch: Figure<{ epoch: number; rewardsUntil: string; updatedAt: string }>
  /**
   * Allocated and not yet claimed: the MerkleDrop balance, but only while the root on chain is
   * the published one. Otherwise the balance still funds the old root and is not this figure.
   */
  readonly rewardsUnclaimed: DerivedFigure
  /** The raw balance, whatever root it funds. */
  readonly merkleDropBalance: Figure<bigint>
  readonly merkleRoot: {
    readonly onChain: Figure<Hex>
    readonly published: Figure<string>
    readonly match: boolean
  }
  /** Where rewards/latest.json was read from: SEF's IPFS dataset, or the repository mirror. */
  readonly rewardsSource: RewardsSourceUsed
}

/** A figure that holds only while the chain root is the published one. */
export type DerivedFigure = Figure<bigint | null> & { readonly reason?: string }

export const ROOT_DIFFERS = "the root on chain differs from the published one"

export async function getStatus(ctx: Context): Promise<NetworkStatus> {
  const { client } = ctx
  const staking = CONTRACTS.staking.address
  const merkleDrop = CONTRACTS.merkleDrop.address
  // Every chain read is pinned to one block, so the figures describe one instant.
  const [blockNumber, validators, { latest, source: rewardsSource }, network] = await Promise.all([
    client.getBlockNumber(),
    fetchValidators(ctx),
    readRewardsLatest(ctx),
    fetchNetworkInfo(ctx),
  ])
  const [totalStaked, pending, root, balance, registered] = await Promise.all([
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

  // tokenTotal is the allocation behind the published root, so it and the balance describe the
  // programme only while the contract holds that root. The same rule as useProgrammeRewards().
  const rootMatches = sameHex(root, latest.merkleRoot)
  const allocated = parseWei(latest.tokenTotal, "SEF's tokenTotal")

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
    rewardsAllocated: rootMatches
      ? figure(allocated, "SEF: rewards/latest.json tokenTotal")
      : { ...figure(null, "SEF: rewards/latest.json tokenTotal"), reason: ROOT_DIFFERS },
    rewardsEpoch: figure(
      { epoch: latest.epoch, rewardsUntil: latest.rewardsUntil, updatedAt: latest.updatedAt },
      "SEF: rewards/latest.json epoch, rewardsUntil, updatedAt",
    ),
    rewardsUnclaimed: rootMatches
      ? figure(balance, "chain: SAFE.balanceOf(MerkleDrop), while its root is the published one")
      : { ...figure(null, "chain: SAFE.balanceOf(MerkleDrop), while its root is the published one"), reason: ROOT_DIFFERS },
    merkleDropBalance: figure(balance, "chain: SAFE.balanceOf(MerkleDrop)"),
    merkleRoot: {
      onChain: figure(root, "chain: MerkleDrop.merkleRoot()"),
      published: figure(latest.merkleRoot, "SEF: rewards/latest.json merkleRoot"),
      match: rootMatches,
    },
    rewardsSource,
  }
}
