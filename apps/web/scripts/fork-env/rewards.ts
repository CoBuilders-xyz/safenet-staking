/**
 * The rewards the fork serves: a Merkle tree built with the app's own tree code from every
 * address that has claimed on Mainnet, at its cumulative amount in SEF's proof file, plus the
 * test account at the test amount. Written in SEF's layout, proofs/<radix>/<address>.json and
 * latest.json, so the app reads them exactly as it reads SEF's.
 *
 * SEF's files are read at the source the settings name: by default the commit core pins next to
 * the fork suites' block, whose root is the one on chain at the default block, so every claimer
 * is carried over and stays so. A claimer is carried over only when its proof carries the root
 * on chain at the fork block: then its amount is the real one for that root. With a source whose
 * root differs, every claimer drops out and only the test account remains. `fork:up` reports
 * both counts and the root match.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { getAddress, type Address, type Hex, type PublicClient } from "viem"
import {
  CONTRACTS, SEF_DATA, indexedEvent, merkleDropAbi, rewardProofUrl, type SefRewardProof, type SefRewardsLatest,
} from "@cobuilders/safenet-core"
import { buildMerkleTree, type MerkleEntry } from "../merkle-tree"
import type { SefSource } from "./settings"

/** Blocks per eth_getLogs request. Anvil forwards each one to the archive endpoint. */
const LOGS_SPAN = 50_000n
const CONCURRENT_FETCHES = 16

export interface RewardsResult {
  root: Hex
  carriedOver: number
  skipped: number
  /** Whether the source's published root is the one on chain at the fork block. */
  sourceRootMatchesFork: boolean
  latest: SefRewardsLatest
}

export async function writeRewards(
  chain: PublicClient,
  source: SefSource,
  account: Address,
  amount: bigint,
  outDir: string,
): Promise<RewardsResult> {
  const forkBlock = await chain.getBlockNumber()
  const onChainRoot = await chain.readContract({ address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "merkleRoot" })
  const claimers = await claimersUpTo(chain, forkBlock)
  if (claimers.has(account)) throw new Error(`${account} has claimed on Mainnet, so it cannot be the test account`)

  const entries: MerkleEntry[] = []
  let skipped = 0
  const addresses = [...claimers]
  for (let i = 0; i < addresses.length; i += CONCURRENT_FETCHES) {
    const batch = addresses.slice(i, i + CONCURRENT_FETCHES)
    const proofs = await Promise.all(batch.map(async (address) => ({ address, proof: await fetchProof(source, address) })))
    for (const { address, proof } of proofs) {
      if (proof && proof.merkleRoot.toLowerCase() === onChainRoot.toLowerCase()) {
        entries.push({ address, amount: BigInt(proof.cumulativeAmount) })
      } else {
        skipped++
      }
    }
  }
  entries.push({ address: account, amount })

  const tree = buildMerkleTree(entries)
  rmSync(outDir, { recursive: true, force: true })
  for (const entry of entries) {
    const file = resolve(outDir, proofPath(entry.address))
    mkdirSync(dirname(file), { recursive: true })
    const proof: SefRewardProof = {
      cumulativeAmount: entry.amount.toString(),
      merkleRoot: tree.root,
      proof: tree.proofs.get(entry.address) ?? null,
    }
    writeFileSync(file, JSON.stringify(proof, null, 2) + "\n")
  }

  // SEF's latest.json with the new root, and the test amount added to what was allocated.
  const published = (await fetchJson(`${source.rewardsBase}/latest.json`)) as SefRewardsLatest
  const latest: SefRewardsLatest = {
    epoch: published.epoch + 1,
    merkleRoot: tree.root,
    rewardsUntil: published.rewardsUntil,
    tokenTotal: (BigInt(published.tokenTotal) + amount).toString(),
    unpaidAmount: published.unpaidAmount,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n")

  return {
    root: tree.root,
    carriedOver: entries.length - 1,
    skipped,
    sourceRootMatchesFork: published.merkleRoot.toLowerCase() === onChainRoot.toLowerCase(),
    latest,
  }
}

/** Every address with a Claimed log on the MerkleDrop up to `toBlock`. */
async function claimersUpTo(chain: PublicClient, toBlock: bigint): Promise<Set<Address>> {
  const event = indexedEvent("merkleDrop", "Claimed")
  const claimers = new Set<Address>()
  for (let from = CONTRACTS.merkleDrop.deployBlock; from <= toBlock; from += LOGS_SPAN) {
    const to = from + LOGS_SPAN - 1n < toBlock ? from + LOGS_SPAN - 1n : toBlock
    const logs = await chain.getLogs({ address: CONTRACTS.merkleDrop.address, event, fromBlock: from, toBlock: to })
    for (const log of logs) if (log.args.account) claimers.add(getAddress(log.args.account))
  }
  return claimers
}

/** The path of an address's proof file under a rewards base, as core derives SEF's URL. */
function proofPath(address: Address): string {
  const base = `${SEF_DATA.rewardsProofBase}/`
  const url = rewardProofUrl(address)
  if (!url.startsWith(base)) throw new Error("rewardProofUrl no longer sits under rewardsProofBase")
  return url.slice(base.length)
}

/** SEF's proof for an address at the source, or null when SEF published none. */
async function fetchProof(source: SefSource, address: Address): Promise<SefRewardProof | null> {
  const url = `${source.rewardsBase}/${proofPath(address)}`
  const res = await fetchWithRetry(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`)
  return (await res.json()) as SefRewardProof
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`)
  return res.json()
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (res.status < 500) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)))
  }
  throw new Error(`GET ${url} failed three times`, { cause: lastError })
}
