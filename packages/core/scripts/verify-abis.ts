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
 *   default    high-frequency events over a recent window. Fast. Every PR.
 *   --deep     every event from its deploy block. Slow. Nightly.
 */
import { createPublicClient, fallback, http, parseAbiItem, toEventSelector, type AbiEvent } from "viem"
import { CHAINS, RPC_URLS } from "../src/chains.js"
import { CONTRACTS } from "../src/contracts.js"
import { INDEXED_EVENTS } from "../src/abis.js"

const deep = process.argv.includes("--deep")
/** Recent-window size per chain. Gnosis blocks are ~5s, Mainnet ~12s. */
const WINDOW = { mainnet: 5_000n, gnosis: 2_000n } as const

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
  checked: string
  ok: boolean
}

async function verify(): Promise<Result[]> {
  const results: Result[] = []

  for (const ev of INDEXED_EVENTS) {
    if (!deep && ev.frequency !== "high") continue

    const ref = CONTRACTS[ev.contract]
    const client = clients[ref.chain]
    const item = parseAbiItem(ev.signature) as AbiEvent
    const topic0 = toEventSelector(item)

    const latest = await client.getBlockNumber()
    if (deep && !("startBlock" in ref && ref.startBlock !== undefined)) {
      throw new Error(
        `--deep needs a startBlock for ${ev.contract}, and contracts.ts has none. Falling back to a ` +
        `recent window would report a correct signature as NO MATCH whenever the event is rare.`,
      )
    }
    const from =
      deep && "startBlock" in ref && ref.startBlock !== undefined
        ? ref.startBlock
        : latest - WINDOW[ref.chain]

    // Filtering by `event` makes viem derive topic0 from OUR signature. If the
    // deployed contract no longer emits it, the result is empty. That is the test.
    // Chunked, because a deep scan spans millions of blocks and providers cap the range.
    // The previous version issued one unchunked request and died on the first rare event,
    // which meant seven of ten signatures were never actually proven.
    let logs: Awaited<ReturnType<typeof client.getLogs>> = []
    let cursor = from < 0n ? 0n : from
    let chunk = 50_000n
    while (cursor <= latest && logs.length === 0) {
      const to = cursor + chunk - 1n > latest ? latest : cursor + chunk - 1n
      try {
        logs = await client.getLogs({ address: ref.address, event: item, fromBlock: cursor, toBlock: to })
        cursor = to + 1n
      } catch (err) {
        if (chunk <= 1_000n) throw err
        chunk /= 4n
      }
    }

    results.push({
      signature: ev.signature.replace(/^event /, "").split("(")[0] ?? ev.signature,
      contract: ev.contract,
      topic0,
      logs: logs.length,
      checked: `${from}..${latest}`,
      ok: logs.length > 0,
    })
  }
  return results
}

const results = await verify()

const pad = (s: string, n: number) => s.padEnd(n)
console.log(`\n  verify:abis  ${deep ? "deep scan from deploy block" : "recent window, high-frequency events"}\n`)
console.log(`  ${pad("EVENT", 24)}${pad("CONTRACT", 18)}${pad("TOPIC0", 14)}${pad("LOGS", 8)}RESULT`)
for (const r of results) {
  console.log(
    `  ${pad(r.signature, 24)}${pad(r.contract, 18)}${pad(r.topic0.slice(0, 10) + "…", 14)}${pad(String(r.logs), 8)}${r.ok ? "match" : "NO MATCH"}`,
  )
}

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.error(
    `\n  ${failed.length} signature(s) produced no logs.\n` +
      `  The contract may have been redeployed. Do NOT edit the signature by reading a\n` +
      `  git branch: neither published branch matches what is deployed. Recover the real\n` +
      `  signature from the chain, then update packages/core/src/abis.ts.\n`,
  )
  process.exit(1)
}
console.log(`\n  ${results.length} signature(s) verified against the chain.\n`)
