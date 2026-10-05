/**
 * verify:abis — prove our event signatures still match the deployed contracts.
 *
 * Why this exists: the Safenet contracts are non-upgradeable, so any change means a
 * deployment to a NEW address. An indexer pointed at the old one keeps running and
 * serves stale data with no error. This check fails the day that happens.
 *
 * Method: compute keccak topic0 for each signature, then ask the chain for logs
 * carrying that topic. A signature that no longer matches produces zero logs.
 *
 *   default    high-frequency events. Fast. Every PR. A tripwire, so it must not depend on
 *              recent activity: it scans WINDOW blocks back from the head and, when an event
 *              has no log there, widens backwards in doubling steps up to CEILING (about 11.5
 *              days on Gnosis, 14 on Mainnet; see verify-abis-scan.ts). It stops at the first
 *              step with a log and prints how many blocks ago the event was last seen. It fails
 *              only when the ceiling holds no log of the event: NO MATCH when the contract
 *              emitted other logs in that span, NO ACTIVITY when it emitted none at all.
 *   --deep     every event from its deploy block. Slow. Nightly. The real proof.
 *
 * Custom errors emit no log. For those, both modes check that the 4-byte selector is in
 * the deployed bytecode. That needs one eth_getCode per contract, so it runs every time.
 */
import {
  createPublicClient,
  encodeErrorResult,
  fallback,
  http,
  parseAbiItem,
  toEventSelector,
  type AbiEvent,
} from "viem"
import { CHAINS, RPC_URLS } from "../src/chains.js"
import { CONTRACTS } from "../src/contracts.js"
import { DECODED_ERRORS, INDEXED_EVENTS } from "../src/abis.js"
import { CEILING, WINDOW, scanFromDeploy, scanRecent, type Status } from "./verify-abis-scan.js"

const deep = process.argv.includes("--deep")

const clients = {
  mainnet: createPublicClient({
    chain: CHAINS.mainnet,
    transport: fallback(RPC_URLS.mainnet.map((url) => http(url))),
  }),
  gnosis: createPublicClient({
    chain: CHAINS.gnosis,
    transport: fallback(RPC_URLS.gnosis.map((url) => http(url))),
  }),
}

interface Result {
  signature: string
  contract: string
  topic0: `0x${string}`
  logs: number
  /** Fast mode: "N blocks ago" for the newest log. Deep mode: the block of the first log. */
  seen: string
  checked: string
  status: Status
}

async function verify(): Promise<Result[]> {
  const results: Result[] = []

  for (const ev of INDEXED_EVENTS) {
    if (!deep && ev.frequency !== "high") continue

    const ref = CONTRACTS[ev.contract]
    const client = clients[ref.chain]
    const item = parseAbiItem(ev.signature) as AbiEvent
    const topic0 = toEventSelector(item)
    const signature = ev.signature.replace(/^event /, "").split("(")[0] ?? ev.signature

    const latest = await client.getBlockNumber()
    if (deep) {
      if (!("startBlock" in ref && ref.startBlock !== undefined)) {
        throw new Error(
          `--deep needs a startBlock for ${ev.contract}, and contracts.ts has none. Falling back to a ` +
          `recent window would report a correct signature as NO MATCH whenever the event is rare.`,
        )
      }
      const scan = await scanFromDeploy(client, ref.address, item, ref.startBlock, latest)
      results.push({
        signature, contract: ev.contract, topic0, logs: scan.logs,
        seen: scan.firstSeen === undefined ? "-" : `block ${scan.firstSeen}`,
        checked: `${ref.startBlock}..${latest}`,
        status: scan.logs > 0 ? "match" : "NO MATCH",
      })
      continue
    }

    const scan = await scanRecent(client, ref.address, item, latest, WINDOW[ref.chain], CEILING[ref.chain])
    results.push({
      signature, contract: ev.contract, topic0, logs: scan.logs,
      seen: scan.lastSeen === undefined ? `none in ${scan.depth} blocks` : `${scan.lastSeen} blocks ago`,
      checked: `${latest - scan.depth}..${latest}`,
      status: scan.status,
    })
  }
  return results
}

/**
 * A selector in the bytecode is weaker proof than a log: it shows the contract can revert with
 * it, not that it does under the conditions we expect. abis.ts records the reverts we observed.
 */
async function verifyErrors(): Promise<Result[]> {
  const results: Result[] = []
  const code = new Map<string, string>()

  for (const err of DECODED_ERRORS) {
    const ref = CONTRACTS[err.contract]
    if (!code.has(err.contract)) {
      const bytecode = await clients[ref.chain].getCode({ address: ref.address })
      code.set(err.contract, (bytecode ?? "0x").toLowerCase())
    }
    const item = parseAbiItem(err.signature)
    const selector = encodeErrorResult({ abi: [item], errorName: item.name })
    const found = code.get(err.contract)!.includes(selector.slice(2).toLowerCase())

    results.push({
      signature: item.name,
      contract: err.contract,
      topic0: selector,
      logs: found ? 1 : 0,
      seen: "bytecode",
      checked: "bytecode",
      status: found ? "match" : "NO MATCH",
    })
  }
  return results
}

const results = [...(await verify()), ...(await verifyErrors())]

const pad = (s: string, n: number) => s.padEnd(n)
console.log(`\n  verify:abis  ${deep ? "deep scan from deploy block" : "recent window, widened when quiet, high-frequency events"}\n`)
console.log(`  ${pad("EVENT", 24)}${pad("CONTRACT", 18)}${pad("TOPIC0", 14)}${pad("LOGS", 8)}${pad(deep ? "FIRST SEEN" : "LAST SEEN", 22)}RESULT`)
for (const r of results) {
  console.log(
    `  ${pad(r.signature, 24)}${pad(r.contract, 18)}${pad(r.topic0.slice(0, 10) + "…", 14)}${pad(r.checked === "bytecode" ? "code" : String(r.logs), 8)}${pad(r.seen, 22)}${r.status}`,
  )
}

const noMatch = results.filter((r) => r.status === "NO MATCH")
const noActivity = results.filter((r) => r.status === "NO ACTIVITY")
if (noMatch.length > 0) {
  console.error(
    deep
      ? `\n  ${noMatch.length} signature(s) produced no logs, or a selector is not in the bytecode.\n` +
        `  The contract may have been redeployed. Do NOT edit the signature by reading a\n` +
        `  git branch: neither published branch matches what is deployed. Recover the real\n` +
        `  signature from the chain, then update packages/core/src/abis.ts.\n`
      : `\n  NO MATCH: ${noMatch.length} signature(s) produced no logs back to the ceiling while the\n` +
        `  contract emitted other logs in that span, or a selector is not in the bytecode.\n` +
        `  The signature in packages/core/src/abis.ts is probably wrong, or the event is not\n` +
        `  high-frequency. Do NOT edit the signature by reading a git branch: neither published\n` +
        `  branch matches what is deployed. Recover the real signature from the chain, and prove\n` +
        `  a rare event with --deep.\n`,
  )
}
if (noActivity.length > 0) {
  console.error(
    `\n  NO ACTIVITY: ${noActivity.length} contract event(s) found no log of any kind back to the\n` +
      `  ceiling. This does not test the signature: the contract is idle, or it was redeployed\n` +
      `  to a new address. Check the address in packages/core/src/contracts.ts against the chain.\n`,
  )
}
if (noMatch.length + noActivity.length > 0) process.exit(1)
console.log(`\n  ${results.length} signature(s) verified against the chain.\n`)
