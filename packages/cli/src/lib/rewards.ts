/** `safenet rewards check` and `safenet rewards history`. */
import type { Address, Hash, Hex } from "viem"
import { CONTRACTS, indexedEvent, merkleDropAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { figure, sameHex, type Figure } from "./figure.js"
import { scanLogs } from "./scan.js"
import { fetchRewardProof, parseWei } from "./sef.js"

export interface RewardsCheck {
  readonly block: bigint
  readonly address: Address
  /** False when SEF published no proof for the address: it never earned rewards. */
  readonly earned: boolean
  readonly proofUrl: string
  /** Everything earned to date. Null when there is no proof. */
  readonly cumulative: Figure<bigint | null>
  readonly claimed: Figure<bigint>
  /** cumulative minus claimed, never below zero. Null when there is no proof. */
  readonly claimable: Figure<bigint | null>
  /** SEF's kycAmount. Null when the file omits it, or when there is no proof. */
  readonly kycAmount: Figure<bigint | null>
  /** SEF's kyc flag. Null when the file omits it, or when there is no proof. */
  readonly kycPassed: Figure<boolean | null>
  /** claimable > 0 and the proof's root is the root on chain. False when there is no proof. */
  readonly canClaim: Figure<boolean>
  /**
   * The part held until compliance checks pass: kycAmount, unless kyc is true. The same rule
   * as heldPendingCompliance() in apps/web.
   */
  readonly heldPendingCompliance: bigint
  /** Null when there is no proof to compare. */
  readonly root: {
    readonly onChain: Figure<Hex>
    readonly proof: Figure<string>
    /** "stale proof" means the file was written for an earlier root and cannot be claimed with. */
    readonly status: "match" | "stale proof"
  } | null
}

export async function checkRewards(ctx: Context, address: Address): Promise<RewardsCheck> {
  const { client } = ctx
  const merkleDrop = CONTRACTS.merkleDrop.address
  const blockNumber = await client.getBlockNumber()
  const [{ proof, url }, claimed, onChainRoot] = await Promise.all([
    fetchRewardProof(ctx, address),
    client.readContract({ address: merkleDrop, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [address], blockNumber }),
    client.readContract({ address: merkleDrop, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber }),
  ])
  const proofSource = "SEF: the address's reward proof file"
  const cumulative = proof ? parseWei(proof.cumulativeAmount, "the proof's cumulativeAmount") : null
  const kycAmount = proof?.kycAmount != null ? parseWei(proof.kycAmount, "the proof's kycAmount") : null
  const kycPassed = proof?.kyc ?? null
  const claimable = cumulative === null ? null : cumulative > claimed ? cumulative - claimed : 0n
  const rootMatches = proof !== null && sameHex(onChainRoot, proof.merkleRoot)

  return {
    block: blockNumber,
    address,
    earned: proof !== null,
    proofUrl: url,
    cumulative: figure(cumulative, `${proofSource}, cumulativeAmount`),
    claimed: figure(claimed, "chain: MerkleDrop.cumulativeClaimed(address)"),
    claimable: figure(claimable, "cumulativeAmount minus cumulativeClaimed"),
    canClaim: figure(
      claimable !== null && claimable > 0n && rootMatches,
      "claimable > 0 and the proof's root is the root on chain",
    ),
    kycAmount: figure(kycAmount, `${proofSource}, kycAmount`),
    kycPassed: figure(kycPassed, `${proofSource}, kyc`),
    heldPendingCompliance: kycAmount !== null && kycPassed !== true ? kycAmount : 0n,
    root: proof
      ? {
          onChain: figure(onChainRoot, "chain: MerkleDrop.merkleRoot()"),
          proof: figure(proof.merkleRoot, `${proofSource}, merkleRoot`),
          status: rootMatches ? "match" : "stale proof",
        }
      : null,
  }
}

export interface Claim {
  readonly block: bigint
  readonly time: Date | null
  readonly transaction: Hash
  readonly amount: bigint
}

export interface RewardsHistory {
  readonly block: bigint
  readonly address: Address
  readonly source: string
  /** Every claim found. */
  readonly count: number
  /** Newest first, at most `limit` unless the limit was lifted. */
  readonly claims: readonly Claim[]
  readonly limited: boolean
  readonly totalClaimed: bigint
  readonly cumulativeClaimed: Figure<bigint>
  /** The claims sum to cumulativeClaimed on chain. False means a claim was missed. */
  readonly sumMatchesChain: boolean
}

export const DEFAULT_HISTORY_LIMIT = 20

export async function rewardsHistory(
  ctx: Context,
  address: Address,
  options: { limit: number | null } = { limit: DEFAULT_HISTORY_LIMIT },
): Promise<RewardsHistory> {
  const { client } = ctx
  const merkleDrop = CONTRACTS.merkleDrop.address
  const from = CONTRACTS.merkleDrop.deployBlock
  const event = indexedEvent("merkleDrop", "Claimed")
  const block = await client.getBlockNumber()
  const [logs, cumulativeClaimed] = await Promise.all([
    scanLogs(ctx, { address: merkleDrop, event, args: { account: address }, fromBlock: from, toBlock: block }),
    client.readContract({
      address: merkleDrop, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [address], blockNumber: block,
    }),
  ])
  const newestFirst = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? (b.logIndex ?? 0) - (a.logIndex ?? 0) : b.blockNumber! > a.blockNumber! ? 1 : -1)
  const shown = options.limit === null ? newestFirst : newestFirst.slice(0, options.limit)

  // Timestamps only for the rows shown, in small batches, so --all on a busy address does
  // not open hundreds of requests at once.
  const times = new Map<bigint, Date>()
  const blocks = [...new Set(shown.map((l) => l.blockNumber!))]
  for (let i = 0; i < blocks.length; i += 20) {
    const slice = blocks.slice(i, i + 20)
    const got = await Promise.all(slice.map((b) => client.getBlock({ blockNumber: b })))
    got.forEach((b) => times.set(b.number, new Date(Number(b.timestamp) * 1000)))
  }

  const totalClaimed = logs.reduce((a, l) => a + (l.args.amount ?? 0n), 0n)
  return {
    block,
    address,
    source: `chain: MerkleDrop ${event.name} logs for this account, from block ${from}`,
    count: logs.length,
    claims: shown.map((l) => ({
      block: l.blockNumber!,
      time: times.get(l.blockNumber!) ?? null,
      transaction: l.transactionHash!,
      amount: l.args.amount ?? 0n,
    })),
    limited: shown.length < logs.length,
    totalClaimed,
    cumulativeClaimed: figure(cumulativeClaimed, "chain: MerkleDrop.cumulativeClaimed(address)"),
    sumMatchesChain: totalClaimed === cumulativeClaimed,
  }
}
