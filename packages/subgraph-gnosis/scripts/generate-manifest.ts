/**
 * Generates subgraph.yaml and abis/*.json from @cobuilders/safenet-core, like the Mainnet
 * package, with one difference: the start block.
 *
 * Gnosis holds roughly 15 million logs over its full history, against 1,835 on Mainnet. A
 * full sync is not a way to iterate. So this takes `--days N` and starts N days back,
 * measured from the chain head using the real block time rather than an assumed one.
 *
 *   pnpm generate --days 2      a validation window, about 34,000 blocks
 *   pnpm generate --full        from the verified deploy block
 *   --prune-never               also asks the indexer to keep every block of history, with
 *                               `indexerHints: prune: never`. Off by default; this package's
 *                               CLAUDE.md records what Studio did with it.
 *
 * A windowed subgraph answers participation, latency and attestation counts, which need only
 * recent data. It cannot answer validator registration history or the epoch record, which
 * need the full chain. Those are separate deployments, not this one promoted.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, fallback, http, parseAbi, type AbiEvent } from "viem"
import { gnosis } from "viem/chains"
import { CONTRACTS, INDEXED_EVENTS, rpcUrls } from "@cobuilders/safenet-core"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")

const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const FULL = process.argv.includes("--full")
const PRUNE_NEVER = process.argv.includes("--prune-never")
const DAYS = Number(argOf("--days") ?? 2)

const SOURCES = [
  { name: "Consensus", contract: "consensus" },
  { name: "FROSTCoordinator", contract: "frostCoordinator" },
] as const

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

async function startBlock(): Promise<bigint> {
  const deployed = CONTRACTS.frostCoordinator.deployBlock
  if (deployed === undefined) throw new Error("frostCoordinator has no verified deployBlock")
  if (FULL) return deployed

  const c = createPublicClient({ chain: gnosis, transport: fallback(rpcUrls("gnosis").map((u) => http(u))) })
  const head = await c.getBlockNumber()
  // Measure the block time rather than assume 5s. The oracle does the same, and an assumed
  // value silently shifts the window.
  const [then, now] = await Promise.all([
    c.getBlock({ blockNumber: head - 20_000n }),
    c.getBlock({ blockNumber: head }),
  ])
  const secondsPerBlock = Number(now.timestamp - then.timestamp) / 20_000
  const span = BigInt(Math.round((DAYS * 86_400) / secondsPerBlock))
  const from = head - span
  console.log(`  block time ${secondsPerBlock.toFixed(2)}s measured, ${DAYS} days = ${span} blocks`)
  return from < deployed ? deployed : from
}

const from = await startBlock()
mkdirSync(resolve(ROOT, "abis"), { recursive: true })

const written: { name: string; address: string; events: number }[] = []

const dataSources = SOURCES.map(({ name, contract }) => {
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

  written.push({ name, address: ref.address, events: events.length })

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
# startBlock is ${FULL ? "the verified deploy block" : `${DAYS} days back from the chain head at generation time`}.
${FULL ? "" : "# A windowed subgraph cannot answer validator registration history or the epoch record.\n"}specVersion: 1.0.0
description: Safenet consensus and signing on Gnosis Chain. CoBuilders, Track A.
repository: https://github.com/CoBuilders-xyz/safenet-staking
${PRUNE_NEVER ? "indexerHints:\n  prune: never\n" : ""}schema:
  file: ./schema.graphql
dataSources:
${dataSources.join("\n")}
`)

console.log(`  wrote subgraph.yaml from block ${from}${FULL ? " (full history)" : ` (${DAYS} days)`}${PRUNE_NEVER ? ", prune: never" : ""}`)
for (const w of written) console.log(`    ${w.name.padEnd(17)} ${w.address}  ${w.events} events`)
