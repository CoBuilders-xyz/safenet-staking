#!/usr/bin/env tsx
/**
 * CLI script to generate Merkle proofs from a config file.
 *
 * Reads scripts/merkle-config.json, builds the Merkle tree, and writes the proof files and
 * latest.json in the shape SEF publishes. The output goes to .rewards/, which git ignores,
 * unless --out names another directory.
 *
 * Usage: pnpm generate:proofs [--out <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { parseArgs } from "util"
import { getAddress, type Address } from "viem"
import type { SefRewardsLatest } from "@cobuilders/safenet-core"
import { buildMerkleTree, type MerkleEntry } from "./merkle-tree"

export interface MerkleConfig {
  epoch: number
  entries: Record<string, string>
  /** ISO 8601. The end of the period the amounts cover. Defaults to the time of the run. */
  rewardsUntil?: string
  /** Decimal string, in wei. Defaults to "0". */
  unpaidAmount?: string
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..")
const CONFIG_PATH = resolve(SCRIPT_DIR, "merkle-config.json")
const DEFAULT_OUT = resolve(PROJECT_ROOT, ".rewards")

function loadConfig(): MerkleConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8")
  const config: unknown = JSON.parse(raw)

  if (
    typeof config !== "object" ||
    config === null ||
    typeof (config as Record<string, unknown>).epoch !== "number" ||
    typeof (config as Record<string, unknown>).entries !== "object" ||
    (config as Record<string, unknown>).entries === null
  ) {
    throw new Error("Invalid merkle-config.json format")
  }

  const { rewardsUntil, unpaidAmount } = config as Record<string, unknown>
  if (rewardsUntil !== undefined && typeof rewardsUntil !== "string") {
    throw new Error("merkle-config.json: rewardsUntil must be an ISO 8601 date")
  }
  if (unpaidAmount !== undefined && (typeof unpaidAmount !== "string" || !/^\d+$/.test(unpaidAmount))) {
    throw new Error("merkle-config.json: unpaidAmount must be a decimal string")
  }

  return config as MerkleConfig
}

// `Date.parse` alone also accepts forms such as "09/22/2026", whose meaning depends on the time zone.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/

/** Accepts only the ISO 8601 shape, and writes it as `toISOString()` does: UTC, with milliseconds. */
function toIsoDate(value: string): string {
  if (!ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`rewardsUntil must be an ISO 8601 date, got ${JSON.stringify(value)}`)
  }
  return new Date(value).toISOString()
}

/** Build the tree for `config` and write `proofs/` and `latest.json` under `outDir`. */
export function generateRewards(config: MerkleConfig, outDir: string, now = new Date()): SefRewardsLatest {
  const entries: MerkleEntry[] = Object.entries(config.entries).map(
    ([addr, amount]) => ({
      address: getAddress(addr) as Address,
      amount: BigInt(amount),
    }),
  )

  if (entries.length === 0) {
    throw new Error("No entries in config")
  }

  console.log(`Building Merkle tree with ${entries.length} entries...`)
  const tree = buildMerkleTree(entries)
  console.log(`Root: ${tree.root}`)

  // Compute total
  const total = entries.reduce((sum, e) => sum + e.amount, 0n)

  // Write individual proof files
  const proofsDir = resolve(outDir, "proofs")
  mkdirSync(proofsDir, { recursive: true })

  let written = 0
  for (const entry of entries) {
    // entry.address is already normalized by getAddress above
    const proof = tree.proofs.get(entry.address)
    if (!proof) {
      throw new Error(`No proof generated for ${entry.address}`)
    }
    const proofFile = {
      cumulativeAmount: entry.amount.toString(),
      merkleRoot: tree.root,
      proof,
    }

    const lower = entry.address.toLowerCase()
    const hex = lower.slice(2, 10)
    const radixDir = resolve(
      proofsDir,
      hex.slice(0, 2),
      hex.slice(2, 4),
      hex.slice(4, 6),
      hex.slice(6, 8),
    )
    mkdirSync(radixDir, { recursive: true })
    const filePath = resolve(radixDir, `${lower}.json`)
    writeFileSync(filePath, JSON.stringify(proofFile, null, 2) + "\n")
    written++
  }

  console.log(`Wrote ${written} proof files to ${proofsDir}`)

  // Write latest.json
  const latest: SefRewardsLatest = {
    epoch: config.epoch,
    merkleRoot: tree.root,
    rewardsUntil: config.rewardsUntil === undefined ? now.toISOString() : toIsoDate(config.rewardsUntil),
    tokenTotal: total.toString(),
    unpaidAmount: config.unpaidAmount ?? "0",
  }

  const latestPath = resolve(outDir, "latest.json")
  writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n")
  console.log(`Wrote ${latestPath}`)
  return latest
}

function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } })
  const outDir = values.out ? resolve(values.out) : DEFAULT_OUT

  console.log("Reading config from", CONFIG_PATH)
  generateRewards(loadConfig(), outDir)
  console.log("Done!")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
