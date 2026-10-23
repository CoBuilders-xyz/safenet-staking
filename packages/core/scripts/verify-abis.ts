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
 *              A contract of a programme that has ended (since 2026-10-23: `programme` in
 *              contracts.ts, closed by PROGRAMME_CLOSED_FROM in sef.ts) will log none of its
 *              events again, so its scan starts instead at the last block before the close,
 *              found by timestamp, and widens back from there. It reports "match (programme
 *              ended)" and how many blocks before the end the event was last seen.
 *   --deep     every event from its deploy block. Slow. Nightly. The real proof.
 *
 * Custom errors and functions emit no log. For those, both modes check that the 4-byte
 * selector is in the deployed bytecode. That needs one eth_getCode per contract, so it runs
 * every time.
 */
import {
  createPublicClient,
  encodeErrorResult,
  fallback,
  http,
  parseAbiItem,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
} from "viem"
import { CHAINS, RPC_URLS } from "../src/chains.js"
import { CONTRACTS, type ContractName, type ContractRef } from "../src/contracts.js"
import { PROGRAMME_CLOSED_FROM, utcDayMs, type Programme } from "../src/sef.js"
import {
  DECODED_ERRORS, INDEXED_EVENTS, erc20Abi, merkleDropAbi, sanctionsOracleAbi, stakingAbi,
} from "../src/abis.js"
import {
  CEILING, WINDOW, lastBlockBefore, scanBeforeClose, scanFromDeploy, scanRecent, type Status,
} from "./verify-abis-scan.js"

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
  /**
   * Fast mode: "N blocks ago" for the newest log, or "N blocks before end" for a closed
   * programme. Deep mode: the block of the first log.
   */
  seen: string
  checked: string
  status: Status
}

interface Anchor { programme: Programme; chain: ContractRef["chain"]; closedAt: Date; block: bigint }

/** The last block of each closed programme, per chain, found once. */
const anchors = new Map<string, Promise<Anchor>>()

function anchorOf(contract: ContractName, latest: bigint): Promise<Anchor> | undefined {
  const ref: ContractRef = CONTRACTS[contract]
  const closedFrom = ref.programme === undefined ? undefined : PROGRAMME_CLOSED_FROM[ref.programme]
  if (ref.programme === undefined || closedFrom === undefined) return undefined
  const floor = ref.deployBlock ?? ref.startBlock
  if (floor === undefined) {
    throw new Error(`${contract} belongs to a closed programme, and contracts.ts gives no block to search its end from.`)
  }
  const key = `${ref.chain}:${ref.programme}`
  let anchor = anchors.get(key)
  if (anchor === undefined) {
    const programme = ref.programme
    const closedAt = new Date(utcDayMs(closedFrom))
    anchor = lastBlockBefore(clients[ref.chain], closedAt, floor, latest)
      .then((block) => ({ programme, chain: ref.chain, closedAt, block }))
    anchors.set(key, anchor)
  }
  return anchor
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

    const closed = anchorOf(ev.contract, latest)
    if (closed !== undefined) {
      const { block } = await closed
      const scan = await scanBeforeClose(client, ref.address, item, block, WINDOW[ref.chain], CEILING[ref.chain])
      results.push({
        signature, contract: ev.contract, topic0, logs: scan.logs,
        seen: scan.lastSeen === undefined
          ? `none in ${scan.depth} before end`
          : `${scan.lastSeen} blocks before end`,
        checked: `${block - scan.depth}..${block}`,
        status: scan.status,
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

/** Deployed bytecode, lower case, fetched once per contract. */
const code = new Map<ContractName, string>()
async function bytecodeOf(contract: ContractName): Promise<string> {
  const cached = code.get(contract)
  if (cached !== undefined) return cached
  const ref = CONTRACTS[contract]
  const bytecode = ((await clients[ref.chain].getCode({ address: ref.address })) ?? "0x").toLowerCase()
  code.set(contract, bytecode)
  return bytecode
}

/**
 * A selector in the bytecode is weaker proof than a log: it shows the contract can revert with
 * it, not that it does under the conditions we expect. abis.ts records the reverts we observed.
 */
async function verifyErrors(): Promise<Result[]> {
  const results: Result[] = []
  for (const err of DECODED_ERRORS) {
    const item = parseAbiItem(err.signature)
    const selector = encodeErrorResult({ abi: [item], errorName: item.name })
    const found = (await bytecodeOf(err.contract)).includes(selector.slice(2).toLowerCase())
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

/**
 * The function ABIs, by the contract they are called on. The Solidity dispatcher compares the
 * calldata against each function's 4-byte selector, so a function the contract has puts its
 * selector in the bytecode, and a signature with a wrong name or argument type does not.
 */
const CALLED: readonly [ContractName, Abi][] = [
  ["staking", stakingAbi],
  ["merkleDrop", merkleDropAbi],
  ["safeToken", erc20Abi],
  ["sanctionsList", sanctionsOracleAbi],
]

async function verifyFunctions(): Promise<Result[]> {
  const results: Result[] = []
  for (const [contract, abi] of CALLED) {
    for (const item of abi) {
      if (item.type !== "function") continue
      const selector = toFunctionSelector(item)
      const found = (await bytecodeOf(contract)).includes(selector.slice(2).toLowerCase())
      results.push({
        signature: item.name, contract, topic0: selector, logs: found ? 1 : 0,
        seen: "bytecode", checked: "bytecode", status: found ? "match" : "NO MATCH",
      })
    }
  }
  return results
}

const results = [...(await verify()), ...(await verifyErrors()), ...(await verifyFunctions())]

const pad = (s: string, n: number) => s.padEnd(n)
console.log(`\n  verify:abis  ${deep ? "deep scan from deploy block" : "recent window, widened when quiet, high-frequency events"}\n`)
for (const anchor of await Promise.all(anchors.values())) {
  console.log(
    `  The ${anchor.programme} programme ended: its ${anchor.chain} contracts are scanned back from block ` +
    `${anchor.block}, the last before ${anchor.closedAt.toISOString()}.\n`,
  )
}
console.log(`  ${pad("EVENT", 24)}${pad("CONTRACT", 18)}${pad("TOPIC0", 14)}${pad("LOGS", 8)}${pad(deep ? "FIRST SEEN" : "LAST SEEN", 28)}RESULT`)
for (const r of results) {
  console.log(
    `  ${pad(r.signature, 24)}${pad(r.contract, 18)}${pad(r.topic0.slice(0, 10) + "…", 14)}${pad(r.checked === "bytecode" ? "code" : String(r.logs), 8)}${pad(r.seen, 28)}${r.status}`,
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
      : `\n  NO MATCH: ${noMatch.length} signature(s) produced no logs back to the ceiling, from the head\n` +
        `  or from the end of a closed programme, while the contract emitted other logs in that span,\n` +
        `  or a selector is not in the bytecode.\n` +
        `  The signature in packages/core/src/abis.ts is probably wrong, or the event is not\n` +
        `  high-frequency. Do NOT edit the signature by reading a git branch: neither published\n` +
        `  branch matches what is deployed. Recover the real signature from the chain, and prove\n` +
        `  a rare event with --deep.\n`,
  )
}
if (noActivity.length > 0) {
  console.error(
    `\n  NO ACTIVITY: ${noActivity.length} contract event(s) found no log of any kind back to the\n` +
      `  ceiling, from the head or from the end of a closed programme. This does not test the\n` +
      `  signature: the contract is idle, or it was redeployed to a new address. Check the address\n` +
      `  in packages/core/src/contracts.ts, and a closed programme's dates in src/sef.ts, against\n` +
      `  the chain.\n`,
  )
}
if (noMatch.length + noActivity.length > 0) process.exit(1)
console.log(`\n  ${results.length} signature(s) verified against the chain.\n`)
