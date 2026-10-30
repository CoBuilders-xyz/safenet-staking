import { createPublicClient, decodeEventLog, encodePacked, getAddress, http, keccak256, type Address, type Hex } from "viem"
import { CHAINS, CONTRACTS, PUBLIC_RPC_URLS, SUBGRAPH_ENDPOINTS, SUBGRAPH_STALE_AFTER_SECONDS,
  indexedEvent, stakingAbi, merkleDropAbi, rewardProofPath, resolveRewardsSource, readRewardsFile } from "@cobuilders/safenet-core"
import { mainnetClient } from "./auth.js"
import type { Chronology, RoundEvent } from "./chronology.js"
import type { Env, Subscription, Trigger } from "./types.js"
import { CHRONOLOGY_BATCH_EVENTS, persistChronologyBatch } from "./archive.js"
import type { Database } from "./db.js"

const abi = [indexedEvent("aegisFrostCoordinator", "SignShared"), indexedEvent("aegisFrostCoordinator", "SignCompleted"),
  indexedEvent("aegisFrostCoordinator", "KeyGenConfirmed"), indexedEvent("aegisConsensus", "ValidatorStakerSet"), indexedEvent("aegisConsensus", "TransactionAttested")]
export async function advanceChronology(env: Env, previous: Chronology, db: Database, holder: string) {
  if (previous.archiveVersion !== 1) throw new Error("Chronology archive migration required")
  const client = createPublicClient({ chain: CHAINS.gnosis, transport: http(env.GNOSIS_RPC_URL || PUBLIC_RPC_URLS.gnosis[0], { timeout: 10_000, retryCount: 1 }) })
  if (await client.getChainId() !== CHAINS.gnosis.id) throw new Error("Gnosis chain mismatch")
  const head = await client.getBlock({ blockTag: "finalized" })
  if (Date.now() / 1000 - Number(head.timestamp) > SUBGRAPH_STALE_AFTER_SECONDS) throw new Error("Gnosis head stale")
  let state = previous
  if (state.hash && (await client.getBlock({ blockNumber: BigInt(state.cursor) })).hash !== state.hash) throw new Error("Finalized checkpoint changed; rebuild required")
  // Bounded backfill per invocation. Never declare the current streak before reaching the head.
  for (let page = 0; page < 10 && BigInt(state.cursor) < head.number; page++) {
    const fromBlock = BigInt(state.cursor) + 1n
    let toBlock = fromBlock + 1999n < head.number ? fromBlock + 1999n : head.number
    const readLogs = () => client.getLogs({ address: [CONTRACTS.aegisFrostCoordinator.address, CONTRACTS.aegisConsensus.address], fromBlock, toBlock })
    let logs = await readLogs()
    // Shrink dense ranges before decoding/hydrating. Commit only complete blocks.
    while (logs.length > CHRONOLOGY_BATCH_EVENTS) {
      if (toBlock === fromBlock) throw new Error("Single block exceeds chronology event capacity")
      toBlock = fromBlock + (toBlock - fromBlock) / 2n
      logs = await readLogs()
    }
    const times = new Map<string, number>()
    const events: RoundEvent[] = []
    for (const log of logs) {
      let decoded
      try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }) } catch { continue }
      const block = log.blockNumber.toString()
      if (!times.has(block)) times.set(block, Number((await client.getBlock({ blockNumber: log.blockNumber })).timestamp))
      const base = { block, index: log.logIndex, time: times.get(block)! }
      const { eventName, args } = decoded
      if (eventName === "SignShared") events.push({ ...base, kind: "share", sid: args.sid, root: args.selectionRoot, participant: args.participant })
      else if (eventName === "SignCompleted") events.push({ ...base, kind: "completed", sid: args.sid, root: args.selectionRoot })
      else if (eventName === "TransactionAttested") events.push({ ...base, kind: "attested", sid: args.signatureId })
      else if (eventName === "ValidatorStakerSet") events.push({ ...base, kind: "member", participant: args.validator, staker: args.staker })
      else if (eventName === "KeyGenConfirmed") events.push({ ...base, kind: "member", participant: args.participant })
    }
    const through = await client.getBlock({ blockNumber: toBlock })
    state = await persistChronologyBatch(db, holder, state, events, toBlock, through.hash, Number(head.timestamp))
  }
  return { state, current: BigInt(state.cursor) === head.number, time: Number(head.timestamp) }
}
export interface Condition { trigger: Trigger; key: string; body: string }

// Mainnet finality normally trails by 2–3 epochs (about 13–19 minutes).
// Allow that lag plus margin; the subgraph's 15-minute bound is not a finality bound.
const MAINNET_FINALIZED_MAX_AGE_SECONDS = 30 * 60

export async function walletConditions(env: Env, sub: Subscription): Promise<{ events: Condition[]; validators: Address[]; failed: number }> {
  const wallet = getAddress(sub.wallet)
  const client = mainnetClient(env)
  if (await client.getChainId() !== CHAINS.mainnet.id) throw new Error("Mainnet chain mismatch")
  const block = await client.getBlock({ blockTag: "finalized" })
  if (Date.now() / 1000 - Number(block.timestamp) > MAINNET_FINALIZED_MAX_AGE_SECONDS) throw new Error("Mainnet head stale")
  const events: Condition[] = []
  let failed = 0
  if (sub.triggers.includes("cooldown")) {
    try {
      // Follow contract queue IDs so two equal withdrawals cannot share a deduplication key.
      const [head] = await client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "withdrawalQueues", args: [wallet], blockNumber: block.number })
      let id = head
      let count = 0
      while (id !== 0n) {
        if (++count > 1000) throw new Error("Withdrawal queue exceeds poll budget")
        const [amount, claimableAt, , next] = await client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "withdrawalNodes", args: [wallet, id], blockNumber: block.number })
        if (amount > 0n && claimableAt <= block.timestamp) events.push({ trigger: "cooldown", key: `cooldown:${id}`, body: "A withdrawal cooldown has ended. Open Safenet to review and claim." })
        id = next
      }
    } catch { failed++ }
  }
  if (sub.triggers.includes("rewards")) {
    try {
      const bases = env.REWARDS_BASE_URL ? [{ kind: "override" as const, url: env.REWARDS_BASE_URL.replace(/\/$/, "") }] : (await resolveRewardsSource(client)).bases
      const { value: proof } = await readRewardsFile<{ cumulativeAmount: string; merkleRoot: Hex; proof: Hex[] | null }>({
        bases, path: rewardProofPath(wallet), attempt: async (url, signal) => {
          const response = await fetch(url, { signal })
          if (response.status === 404) return null
          if (!response.ok) throw new Error("Reward proof unavailable")
          return response.json()
        },
      })
      if (proof) {
        if (!/^\d+$/.test(proof.cumulativeAmount)) throw new Error("Invalid reward amount")
        if (proof.proof !== null) {
          if (!Array.isArray(proof.proof) || proof.proof.length > 128) throw new Error("Invalid reward proof")
          let leaf = keccak256(encodePacked(["address", "uint256"], [wallet, BigInt(proof.cumulativeAmount)]))
          for (const sibling of proof.proof) {
            if (!/^0x[\da-f]{64}$/i.test(sibling)) throw new Error("Invalid reward proof")
            leaf = keccak256(encodePacked(["bytes32", "bytes32"], leaf.toLowerCase() < sibling.toLowerCase() ? [leaf, sibling] : [sibling, leaf]))
          }
          const [root, claimed] = await Promise.all([
            client.readContract({ address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber: block.number }),
            client.readContract({ address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [wallet], blockNumber: block.number }),
          ])
          if (leaf.toLowerCase() === root.toLowerCase() && proof.merkleRoot.toLowerCase() === root.toLowerCase() && BigInt(proof.cumulativeAmount) > claimed) {
            events.push({ trigger: "rewards", key: `rewards:${root}:${proof.cumulativeAmount}`, body: "Rewards are claimable. Open Safenet to review the verified reward proof." })
          }
        }
      }
    } catch { failed++ }
  }
  const validators: Address[] = []
  if (sub.triggers.some(t => ["deregistered", "participation", "missed"].includes(t))) {
    try {
      // Pin all pagination to one indexed block. Verify each position and status on chain.
      let cursor = ""
      let indexedBlock: number | undefined
      for (;;) {
        const response = await fetch(env.SUBGRAPH_URL_MAINNET || SUBGRAPH_ENDPOINTS.mainnet, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ query: `query($wallet: Bytes!, $cursor: ID!, $block: Block_height) {
            _meta(block: $block) { block { number timestamp } hasIndexingErrors }
            delegations(first: 100, orderBy: id, orderDirection: asc, block: $block, where: {staker: $wallet, amount_gt: "0", id_gt: $cursor}) { id validator { id registeredAtBlock } }
          }`, variables: { wallet: wallet.toLowerCase(), cursor, block: indexedBlock ? { number: indexedBlock } : { number: Number(block.number) } } }),
        })
        if (!response.ok) throw new Error("Delegation index unavailable")
        const json = await response.json() as { errors?: unknown; data?: { _meta: { block: { number: number; timestamp: number }; hasIndexingErrors: boolean }; delegations: { id: string; validator: { id: Address; registeredAtBlock: string | null } }[] } }
        const data = json.data
        if (json.errors || !data || data._meta.hasIndexingErrors || Number(block.timestamp) - data._meta.block.timestamp > SUBGRAPH_STALE_AFTER_SECONDS) throw new Error("Delegation index stale")
        indexedBlock = data._meta.block.number
        for (const row of data.delegations) {
          const validator = getAddress(row.validator.id)
          const stake = await client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "stakes", args: [wallet, validator], blockNumber: block.number })
          if (stake === 0n) continue
          validators.push(validator)
          if (sub.triggers.includes("deregistered")) {
            const registered = await client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "isValidator", args: [validator], blockNumber: block.number })
            if (!registered) events.push({ trigger: "deregistered", key: `deregistered:${validator}:${row.validator.registeredAtBlock ?? "unknown"}`, body: `Your validator ${validator} is deregistered. Review your delegation.` })
          }
        }
        if (data.delegations.length < 100) break
        cursor = data.delegations.at(-1)!.id
        if (validators.length > 1000) throw new Error("Delegation poll budget exceeded")
      }
    } catch { failed++ }
  }
  return { events, validators, failed }
}
