/**
 * Generates subgraph.yaml and abis/*.json from @cobuilders/safenet-core, like the Mainnet
 * package, with one difference: the start blocks.
 *
 * Two programmes are indexed, each from its own contracts in GNOSIS_CONTRACTS: Beta, which has
 * ended, and Aegis, which runs.
 *
 * Aegis always starts at each contract's verified deploy block. Its three weeks to 2026-10-27
 * held 18,268 logs, so its whole history is cheap.
 *
 * Beta holds roughly 15 million logs over its full history, against 1,835 on Mainnet. A full
 * sync is not a way to iterate. So `--days N` starts Beta N days before the end of its last
 * day, BETA_END_DAY, found by timestamp on the chain: the history the Network Overview shows.
 * Its data sources keep running after that, so a stray ceremony after the end is still seen.
 *
 *   pnpm generate --days 16     Beta's last 16 days, the deploy default
 *   pnpm generate --full        Beta from its verified deploy block too
 *   --prune-never               also asks the indexer to keep every block of history, with
 *                               `indexerHints: prune: never`. Off by default; this package's
 *                               CLAUDE.md records what Studio did with it.
 *
 * A windowed subgraph cannot answer Beta's validator registration history or epoch record,
 * which need its full chain. Those are a separate deployment, not this one promoted.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, fallback, http, parseAbi, type AbiEvent } from "viem"
import { gnosis } from "viem/chains"
import {
  BETA_END_DAY, CONTRACTS, GNOSIS_CONTRACTS, INDEXED_EVENTS, rpcUrls, utcDayMs, type ContractName, type ContractRef, type Programme,
} from "@cobuilders/safenet-core"
import { blockAtTimestamp } from "@cobuilders/safenet-core/parity"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")

const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const FULL = process.argv.includes("--full")
const PRUNE_NEVER = process.argv.includes("--prune-never")
const DAYS = Number(argOf("--days") ?? 16)

/**
 * One data source per contract and programme. Beta's keep the names they had before Aegis, so
 * their generated bindings and mapping files keep theirs. The mapping file is the name in lower
 * case, and passes its programme to every row it writes.
 */
const SOURCES: readonly { name: string; contract: ContractName; programme: Programme }[] = [
  { name: "Consensus", contract: GNOSIS_CONTRACTS.beta.consensus, programme: "beta" },
  { name: "FROSTCoordinator", contract: GNOSIS_CONTRACTS.beta.frostCoordinator, programme: "beta" },
  { name: "AegisConsensus", contract: GNOSIS_CONTRACTS.aegis.consensus, programme: "aegis" },
  { name: "AegisFROSTCoordinator", contract: GNOSIS_CONTRACTS.aegis.frostCoordinator, programme: "aegis" },
]

const HANDLERS: Record<string, string> = {
  TransactionProposed: "handleTransactionProposed",
  TransactionAttested: "handleTransactionAttested",
  EpochRolledOver: "handleEpochRolledOver",
  ValidatorStakerSet: "handleValidatorStakerSet",
  SignShared: "handleSignShared",
  SignCompleted: "handleSignCompleted",
  KeyGenConfirmed: "handleKeyGenConfirmed",
}

const eventsFor = (contract: string): AbiEvent[] =>
  INDEXED_EVENTS.filter((e) => e.contract === contract).map(
    (e) => parseAbi([e.signature])[0] as AbiEvent,
  )

const manifestSignature = (e: AbiEvent): string =>
  `${e.name}(${e.inputs.map((i) => `${i.indexed ? "indexed " : ""}${abiType(i)}`).join(",")})`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function abiType(input: any): string {
  if (input.type === "tuple") return `(${input.components.map(abiType).join(",")})`
  if (input.type === "tuple[]") return `(${input.components.map(abiType).join(",")})[]`
  return input.type
}

function deployBlockOf(contract: ContractName): bigint {
  const ref: ContractRef = CONTRACTS[contract]
  if (ref.deployBlock === undefined) throw new Error(`${contract} has no verified deployBlock`)
  return ref.deployBlock
}

/**
 * Where Beta's data sources start: its coordinator's deploy block under --full, otherwise the
 * first block DAYS days before the end of BETA_END_DAY. Both of Beta's sources start there, so a
 * ceremony is never seen by one and not the other.
 */
async function betaStart(): Promise<bigint> {
  const deployed = deployBlockOf(GNOSIS_CONTRACTS.beta.frostCoordinator)
  if (FULL) return deployed

  const c = createPublicClient({ chain: gnosis, transport: fallback(rpcUrls("gnosis").map((u) => http(u))) })
  const end = utcDayMs(BETA_END_DAY) + 86_400_000
  const target = BigInt((end - DAYS * 86_400_000) / 1000)
  const from = await blockAtTimestamp({
    timestampOf: async (n) => (await c.getBlock({ blockNumber: n })).timestamp,
    lo: deployed, hi: await c.getBlockNumber(), target, side: "first",
  })
  console.log(`  Beta from ${new Date(Number(target) * 1000).toISOString()}, ${DAYS} days before its end`)
  return from
}

const betaFrom = await betaStart()
const startOf = (contract: ContractName, programme: Programme): bigint =>
  programme === "beta" ? betaFrom : deployBlockOf(contract)
mkdirSync(resolve(ROOT, "abis"), { recursive: true })

const written: { name: string; address: string; events: number; from: bigint }[] = []

const dataSources = SOURCES.map(({ name, contract, programme }) => {
  const from = startOf(contract, programme)
  const ref = CONTRACTS[contract]
  const events = eventsFor(contract)
  if (events.length === 0) throw new Error(`no indexed events for ${contract}`)

  // graph-node requires `anonymous` on every event; viem's parseAbi omits it, and both
  // codegen and build accept the result. Only the node rejects it, at deploy time.
  writeFileSync(
    resolve(ROOT, `abis/${name}.json`),
    JSON.stringify(events.map((e) => ({ ...e, anonymous: false })), null, 2) + "\n",
  )

  const handlers = events.map((e) => {
    const h = HANDLERS[e.name]
    if (!h) throw new Error(`no handler mapped for ${name}.${e.name}`)
    return `        - event: ${manifestSignature(e)}\n          handler: ${h}`
  })

  written.push({ name, address: ref.address, events: events.length, from })

  return `  - kind: ethereum
    name: ${name}
    network: gnosis
    source:
      address: "${ref.address}"
      abi: ${name}
      startBlock: ${from}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./src/${name.toLowerCase()}.ts
      entities: []
      abis:
        - name: ${name}
          file: ./abis/${name}.json
      eventHandlers:
${handlers.join("\n")}`
})

writeFileSync(resolve(ROOT, "subgraph.yaml"), `# GENERATED FILE. Do not edit by hand.
# Produced by: pnpm --filter @cobuilders/safenet-subgraph-gnosis generate${FULL ? " --full" : ` --days ${DAYS}`}${PRUNE_NEVER ? " --prune-never" : ""}
# From:        packages/core/src/contracts.ts and packages/core/src/abis.ts
#
# Aegis starts at each contract's verified deploy block. Beta starts at ${FULL ? "its verified deploy block" : `the first block ${DAYS} days before the end of its last day`}.
${FULL ? "" : "# A windowed subgraph cannot answer Beta's validator registration history or epoch record.\n"}specVersion: 1.0.0
description: Safenet consensus and signing on Gnosis Chain. CoBuilders, Track A.
repository: https://github.com/CoBuilders-xyz/safenet-staking
${PRUNE_NEVER ? "indexerHints:\n  prune: never\n" : ""}schema:
  file: ./schema.graphql
dataSources:
${dataSources.join("\n")}
`)

console.log(`  wrote subgraph.yaml${FULL ? " (full history)" : ` (Beta's last ${DAYS} days, all of Aegis)`}${PRUNE_NEVER ? ", prune: never" : ""}`)
for (const w of written) console.log(`    ${w.name.padEnd(22)} ${w.address}  ${w.events} events  from block ${w.from}`)
