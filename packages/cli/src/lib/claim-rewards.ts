/**
 * `safenet rewards claim` and `safenet rewards claim-and-stake`.
 *
 * The claim sends what SEF published for the address, read through core's `rewardProofUrl()`,
 * and only while the proof's root is the root on chain. A stale proof is refused before
 * anything is simulated: the contract would revert with `MerkleRootWasUpdated` or
 * `InvalidProof`, and the reason is SEF's publishing, not the user's input.
 *
 * Claim & Stake then stakes what arrived, read from the SAFE `Transfer` log of the claim, not
 * the amount the proof promised: the contract pays the difference from what it already paid,
 * and the transfer is what the wallet actually holds. The same rule as claimedAmountFromLogs()
 * in the web app. The CLI sends the steps one after another; it does not batch them.
 */
import { isAddressEqual, parseEventLogs, type Address, type Hex, type Log } from "viem"
import { CONTRACTS, merkleDropAbi, safeTokenEventsAbi } from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { figure, sameHex, type Figure } from "./figure.js"
import { fetchRewardProof, parseWei } from "./sef.js"
import { actor, readStake, requireValidator, runStake, type Approval, type ApprovalKind } from "./stake.js"
import {
  WriteError, amount, call, createRunner, type Amount, type Call, type Runner, type WriteMode, type WriteOptions,
  type WriteResultBase,
} from "./transactions.js"

const MERKLE_DROP = CONTRACTS.merkleDrop.address
const SAFE_TOKEN = CONTRACTS.safeToken.address

export interface RewardsClaim {
  readonly proofUrl: string
  /** The root on chain, which is also the proof's: a proof for another root is refused. */
  readonly merkleRoot: Figure<Hex>
  readonly cumulative: Figure<Amount>
  readonly claimedBefore: Figure<Amount>
  readonly claimable: Figure<Amount>
  /**
   * What the claim moved from the MerkleDrop to the account: from the receipt, or from the
   * simulation in a dry run. Null when no such transfer is in it, which a caller treats as
   * unknown, never as zero.
   */
  readonly received: Figure<Amount | null>
  /** Read after the claim confirmed. Null in a dry run. */
  readonly claimedAfter: Figure<Amount> | null
}

/** SAFE moved from the MerkleDrop to `account` by the logs of one claim, or undefined. */
export function receivedFromLogs(logs: readonly Log[], account: Address): bigint | undefined {
  const transfers = parseEventLogs({ abi: safeTokenEventsAbi, eventName: "Transfer", logs: [...logs], strict: true })
    .filter((log) =>
      isAddressEqual(log.address, SAFE_TOKEN) &&
      isAddressEqual(log.args.from, MERKLE_DROP) &&
      isAddressEqual(log.args.to, account))
  if (transfers.length === 0) return undefined
  return transfers.reduce((sum, log) => sum + log.args.value, 0n)
}

interface PreparedClaim {
  readonly call: Call
  readonly figures: Omit<RewardsClaim, "received" | "claimedAfter">
}

const isBytes32 = (s: unknown): s is Hex => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s)

/** Reads the proof and the chain, and refuses a claim that cannot succeed, in one sentence. */
async function prepareClaim(ctx: Context, account: Address, blockNumber: bigint): Promise<PreparedClaim> {
  const read = { address: MERKLE_DROP, abi: merkleDropAbi, blockNumber } as const
  const [{ proof, url }, root, claimed] = await Promise.all([
    fetchRewardProof(ctx, account),
    ctx.client.readContract({ ...read, functionName: "merkleRoot" }),
    ctx.client.readContract({ ...read, functionName: "cumulativeClaimed", args: [account] }),
  ])
  if (!proof) throw new SafenetError(`SEF published no reward proof for ${account}, so it has no rewards to claim`)
  if (!sameHex(proof.merkleRoot, root)) {
    throw new SafenetError(
      `SEF's proof for ${account} is stale: it was written for Merkle root ${proof.merkleRoot}, the MerkleDrop ` +
        `now holds ${root}, and a claim can only succeed once SEF publishes the proofs for the current root`,
    )
  }
  const cumulative = parseWei(proof.cumulativeAmount, "the proof's cumulativeAmount")
  if (cumulative <= claimed) {
    throw new SafenetError(
      `${account} has already claimed all ${amount(cumulative).safe} SAFE it has earned to date`,
    )
  }
  const hashes = proof.proof
  if (!Array.isArray(hashes) || !hashes.every(isBytes32)) {
    throw new SafenetError(`SEF's proof file for ${account} carries no usable Merkle proof, so no claim can be sent`)
  }
  const source = "SEF: the address's reward proof file"
  return {
    call: call("MerkleDrop", MERKLE_DROP, merkleDropAbi, "claim", [account, cumulative, root, hashes]),
    figures: {
      proofUrl: url,
      merkleRoot: figure(root, "chain: MerkleDrop.merkleRoot(), equal to the proof's merkleRoot"),
      cumulative: figure(amount(cumulative), `${source}, cumulativeAmount`),
      claimedBefore: figure(amount(claimed), "chain: MerkleDrop.cumulativeClaimed(address)"),
      claimable: figure(amount(cumulative - claimed), "cumulativeAmount minus cumulativeClaimed"),
    },
  }
}

async function runClaim(
  runner: Runner,
  prepared: PreparedClaim,
): Promise<{ received: bigint | undefined; source: string }> {
  const { logs } = await runner.run(prepared.call, { logs: true })
  const from = runner.dryRun ? "the simulated claim" : "the claim's receipt"
  return {
    received: receivedFromLogs(logs, runner.from),
    source: `chain: SAFE Transfer logs from the MerkleDrop to the account in ${from}`,
  }
}

async function readClaimed(ctx: Context, account: Address): Promise<Figure<Amount>> {
  const wei = await ctx.client.readContract({
    address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [account],
  })
  return figure(amount(wei), "chain: MerkleDrop.cumulativeClaimed(address)")
}

export interface RewardsClaimResult extends WriteResultBase {
  readonly operation: "rewards claim"
  readonly claim: RewardsClaim
}

export async function claimRewards(
  ctx: Context,
  mode: WriteMode,
  options: WriteOptions = {},
): Promise<RewardsClaimResult> {
  const from = actor(mode)
  const block = await ctx.client.getBlockNumber()
  const prepared = await prepareClaim(ctx, from, block)
  const runner = await createRunner(ctx, mode, options)
  const { received, source } = await runClaim(runner, prepared)
  return {
    operation: "rewards claim",
    dryRun: mode.dryRun,
    from,
    block,
    claim: {
      ...prepared.figures,
      received: figure(received === undefined ? null : amount(received), source),
      claimedAfter: mode.dryRun ? null : await readClaimed(ctx, from),
    },
    steps: runner.steps,
  }
}

export interface ClaimAndStakeResult extends WriteResultBase {
  readonly operation: "rewards claim-and-stake"
  readonly validator: Address
  readonly claim: RewardsClaim
  /** --amount, when given. */
  readonly requested: Amount | null
  /** What was staked: what arrived, or the requested amount when that is lower. */
  readonly staked: Amount
  readonly allowance: Figure<Amount>
  readonly approval: Approval | null
  readonly stakeBefore: Figure<Amount>
  readonly stakeAfter: Figure<Amount> | null
}

export async function claimAndStake(
  ctx: Context,
  mode: WriteMode,
  input: { validator: Address; amount?: bigint | undefined; approve: ApprovalKind },
  options: WriteOptions = {},
): Promise<ClaimAndStakeResult> {
  const from = actor(mode)
  const block = await ctx.client.getBlockNumber()
  // Before the claim, so a validator that cannot be staked on is refused before anything is sent.
  await requireValidator(ctx, input.validator, block)
  const [prepared, stakeBefore] = await Promise.all([
    prepareClaim(ctx, from, block),
    readStake(ctx, from, input.validator, block),
  ])
  const runner = await createRunner(ctx, mode, options)
  const { received, source } = await runClaim(runner, prepared)
  if (received === undefined) {
    const where = runner.steps[0]?.transaction ? `confirmed in ${runner.steps[0].transaction.hash}, but its receipt` : "simulation"
    throw new WriteError(
      `The claim ${where} shows no SAFE transfer from the MerkleDrop to ${from}, so the amount to stake is unknown and nothing is staked`,
      runner.steps,
    )
  }
  if (!mode.dryRun) options.onProgress?.({ type: "received", amount: amount(received), source })

  const staked = input.amount !== undefined && input.amount < received ? input.amount : received
  const { allowance, approval } = await runStake(ctx, runner, {
    validator: input.validator,
    amount: staked,
    approve: input.approve,
    // A dry run reads the allowance at the block it started from, which the claim does not change.
    // A live run reads it after the claim confirmed.
    blockNumber: mode.dryRun ? block : undefined,
  })
  return {
    operation: "rewards claim-and-stake",
    dryRun: mode.dryRun,
    from,
    block,
    validator: input.validator,
    claim: {
      ...prepared.figures,
      received: figure(amount(received), source),
      claimedAfter: mode.dryRun ? null : await readClaimed(ctx, from),
    },
    requested: input.amount === undefined ? null : amount(input.amount),
    staked: amount(staked),
    allowance,
    approval,
    stakeBefore,
    stakeAfter: mode.dryRun ? null : await readStake(ctx, from, input.validator),
    steps: runner.steps,
  }
}
