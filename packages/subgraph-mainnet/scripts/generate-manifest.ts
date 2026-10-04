/**
 * Generates subgraph.yaml and abis/*.json from @cobuilders/safenet-core.
 *
 * A subgraph manifest carries a contract address and a start block. An ABI file carries
 * event signatures. Those are written in packages/core and nowhere else, so
 * neither file is authored by hand: both are outputs.
 *
 * This also means `pnpm verify:abis` covers the subgraph. It re-derives every signature
 * against the chain, and the signatures it checks are the ones this script emits.
 *
 * Both generated files are gitignored. Run `pnpm generate` before codegen; the package
 * scripts already do.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseAbi, type AbiEvent } from "viem"
import { CONTRACTS, INDEXED_EVENTS } from "@cobuilders/safenet-core"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")

/** Only Mainnet. The Gnosis contracts get their own package. */
const SOURCES = [
  { name: "Staking", contract: "staking" },
  { name: "MerkleDrop", contract: "merkleDrop" },
] as const

/** The handler this subgraph defines for each event name. */
const HANDLERS: Record<string, string> = {
  StakeIncreased: "handleStakeIncreased",
  WithdrawalInitiated: "handleWithdrawalInitiated",
  WithdrawalClaimed: "handleWithdrawalClaimed",
  ValidatorUpdated: "handleValidatorUpdated",
  Claimed: "handleClaimed",
  MerkelRootUpdated: "handleMerkelRootUpdated",
}

const eventsFor = (contract: string): AbiEvent[] =>
  INDEXED_EVENTS.filter((e) => e.contract === contract).map(
    (e) => parseAbi([e.signature])[0] as AbiEvent,
  )

/** The `Name(type,type)` form a manifest needs, with `indexed` marked. */
const manifestSignature = (e: AbiEvent): string =>
  `${e.name}(${e.inputs.map((i) => `${i.indexed ? "indexed " : ""}${abiType(i)}`).join(",")})`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function abiType(input: any): string {
  if (input.type === "tuple") return `(${input.components.map(abiType).join(",")})`
  if (input.type === "tuple[]") return `(${input.components.map(abiType).join(",")})[]`
  return input.type
}

mkdirSync(resolve(ROOT, "abis"), { recursive: true })

const written: { name: string; address: string; from: bigint }[] = []

const dataSources = SOURCES.map(({ name, contract }) => {
  const ref = CONTRACTS[contract]
  const events = eventsFor(contract)
  if (events.length === 0) throw new Error(`no indexed events for ${contract}`)
  // deployBlock, never startBlock: the latter is a scan floor for verify:abis and can sit
  // far earlier. MerkleDrop's floor is 164,000 blocks before it existed.
  const from = "deployBlock" in ref ? ref.deployBlock : undefined
  if (from === undefined) throw new Error(`${contract} has no verified deployBlock in core`)

  // graph-node deserialises the ABI strictly and requires `anonymous` on every event.
  // viem's parseAbi omits it, and both `graph codegen` and `graph build` accept the result;
  // only the node rejects it, at deploy time, with "missing field `anonymous`".
  const abi = events.map((e) => ({ ...e, anonymous: false }))
  writeFileSync(resolve(ROOT, `abis/${name}.json`), JSON.stringify(abi, null, 2) + "\n")

  const handlers = events.map((e) => {
    const h = HANDLERS[e.name]
    if (!h) throw new Error(`no handler mapped for ${name}.${e.name}`)
    return `        - event: ${manifestSignature(e)}\n          handler: ${h}`
  })

  written.push({ name, address: ref.address, from })

  return `  - kind: ethereum
    name: ${name}
    network: mainnet
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

const manifest = `# GENERATED FILE. Do not edit by hand.
# Produced by: pnpm --filter @cobuilders/safenet-subgraph-mainnet generate
# From:        packages/core/src/contracts.ts and packages/core/src/abis.ts
#
# Addresses, start blocks and event signatures live in core. Editing this file
# creates a second source for them, which is the drift that rule exists to prevent.
specVersion: 1.0.0
description: Safenet Beta staking and rewards on Ethereum Mainnet. CoBuilders, Track A.
repository: https://github.com/CoBuilders-xyz/safenet-staking
schema:
  file: ./schema.graphql
dataSources:
${dataSources.join("\n")}
`

writeFileSync(resolve(ROOT, "subgraph.yaml"), manifest)
console.log(`  wrote subgraph.yaml and ${written.length} ABI files, from packages/core`)
for (const w of written) {
  console.log(`    ${w.name.padEnd(11)} ${w.address}  from block ${w.from}`)
}
