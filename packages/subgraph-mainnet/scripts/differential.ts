/**
 * Layer two of validation: the subgraph against the chain, and against the oracle.
 *
 * The matchstick tests prove each handler does what I meant, using events I wrote. They
 * cannot prove the event shapes, the addresses or the totals are right, because they never
 * touch a chain.
 *
 * This does. It reads the subgraph, reads the contracts directly, and asserts they agree.
 *
 * The three conservation identities are D-055, each already proven by metrics-poc.ts against
 * live chains over seven review rounds:
 *
 *   stakes minus withdrawals          == totalStakedAmount()
 *   initiated minus claimed           == totalPendingWithdrawals()
 *   allocated minus claimed           == the live MerkleDrop balance
 *
 * Usage: pnpm --filter @cobuilders/safenet-subgraph-mainnet differential
 */
import { createPublicClient, fallback, http, parseAbi } from "viem"
import { mainnet } from "viem/chains"
import { CONTRACTS } from "@cobuilders/safenet-core"
import { rpcUrls } from "@cobuilders/safenet-core"

const PORT = process.env.GRAPH_NODE_PORT ?? "8000"
const ENDPOINT = `http://localhost:${PORT}/subgraphs/name/safenet/mainnet`

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(rpcUrls("mainnet").map((u) => http(u))),
})

const stakingAbi = parseAbi([
  "function totalStakedAmount() view returns (uint256)",
  "function totalPendingWithdrawals() view returns (uint256)",
])
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"])
const dropAbi = parseAbi(["function merkleRoot() view returns (bytes32)"])

async function query<T>(gql: string): Promise<T> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: gql }),
  })
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] }
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "))
  if (!j.data) throw new Error("no data in response")
  return j.data
}

let failures = 0
function check(label: string, ours: bigint | number | string, theirs: bigint | number | string, note = ""): void {
  const ok = ours.toString() === theirs.toString()
  if (!ok) failures++
  const mark = ok ? "OK  " : "FAIL"
  console.log(`  ${mark} ${label.padEnd(38)} subgraph ${String(ours).padStart(28)}`)
  if (!ok) console.log(`       ${" ".repeat(38)} chain    ${String(theirs).padStart(28)}`)
  if (note) console.log(`       ${note}`)
}

async function main(): Promise<void> {
  const meta = await query<{ _meta: { block: { number: number }; hasIndexingErrors: boolean } }>(
    `{ _meta { block { number } hasIndexingErrors } }`,
  )
  const at = BigInt(meta._meta.block.number)
  console.log(`\n  subgraph indexed to block ${at}`)

  // Refuse rather than compare against a partial index. A freshly deployed subgraph reports
  // its start block, one before the contract existed, and every contract read then returns
  // "0x" with a message that says nothing about the real cause.
  const deployed = 24_585_750n
  if (at < deployed) {
    console.error(
      `\n  the subgraph has indexed nothing yet: block ${at} is before the Staking deploy` +
      `\n  at ${deployed}. Wait for it to sync, then run this again.\n`,
    )
    process.exit(1)
  }
  if (meta._meta.hasIndexingErrors) {
    console.error("  the subgraph reports indexing errors; results below are not trustworthy")
    failures++
  }

  // Read the contracts at the SAME block the subgraph reached. Comparing against the chain
  // head instead would measure the lag between them, not whether they agree.
  const [totalStaked, pending, dropBalance, chainRoot] = await Promise.all([
    client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalStakedAmount", blockNumber: at }),
    client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalPendingWithdrawals", blockNumber: at }),
    client.readContract({ address: CONTRACTS.safeToken.address, abi: erc20Abi, functionName: "balanceOf", args: [CONTRACTS.merkleDrop.address], blockNumber: at }),
    client.readContract({ address: CONTRACTS.merkleDrop.address, abi: dropAbi, functionName: "merkleRoot", blockNumber: at }),
  ])

  const d = await query<{
    network: {
      totalStaked: string; pendingWithdrawals: string; rewardsClaimed: string
      activeValidators: number
      stakersCurrent: number; stakersEver: number
      delegationsCurrent: number; delegationsEver: number
      stakeCount: number; withdrawalCount: number
      rewardPeriods: number; currentRoot: string | null
    } | null
    validators: { id: string; totalStaked: string; stakersCurrent: number }[]
    withdrawals: { id: string }[]
    rewardPeriods: { id: string; period: number; root: string; previousRoot: string; cumulativeClaimedAtStart: string }[]
  }>(`{
    network(id: "1") {
      totalStaked pendingWithdrawals rewardsClaimed
      activeValidators stakersCurrent stakersEver
      delegationsCurrent delegationsEver
      stakeCount withdrawalCount
      rewardPeriods currentRoot
    }
    validators(first: 100) { id totalStaked stakersCurrent }
    withdrawals(first: 1000, where: { claimed: false }) { id }
    rewardPeriods(first: 100, orderBy: period) { id period root previousRoot cumulativeClaimedAtStart }
  }`)

  if (!d.network) throw new Error("no Network entity: the subgraph indexed no events")
  const n = d.network

  console.log("\n  D-055, the three conservation identities\n")
  check("stakes minus withdrawals", BigInt(n.totalStaked), totalStaked)
  check("initiated minus claimed", BigInt(n.pendingWithdrawals), pending)

  // The drop balance is what is left unclaimed, so allocated minus claimed. We hold claimed,
  // not allocated, so this asserts the relationship the other way round: the balance plus what
  // we say was claimed must equal what was ever funded. Reported, not asserted, until the
  // funding total is indexed too.
  console.log(`\n  MerkleDrop balance at this block      ${dropBalance}`)
  console.log(`  rewards claimed, per the subgraph     ${n.rewardsClaimed}`)
  console.log(`  implied total funded                  ${dropBalance + BigInt(n.rewardsClaimed)}`)

  console.log("\n  The reward root history\n")
  // The last root we indexed must be the root the contract reports now. If a distribution
  // were missed, this is where it shows: the chain would be ahead of us.
  check("current root", n.currentRoot ?? "none", chainRoot)
  console.log(`       distributions indexed              ${n.rewardPeriods}`)

  // Each period's previousRoot must be the prior period's root. A gap means a missed event.
  let chainBroken = 0
  for (let i = 1; i < d.rewardPeriods.length; i++) {
    const here = d.rewardPeriods[i]
    const before = d.rewardPeriods[i - 1]
    if (!here || !before) continue
    if (here.previousRoot !== before.root) chainBroken++
  }
  check("root chain is unbroken", chainBroken, 0, "each period's previousRoot equals the prior root")

  console.log("\n  Sums across entities must equal the network row\n")
  const sumValidators = d.validators.reduce((a, v) => a + BigInt(v.totalStaked), 0n)
  check("sum of validator stakes", sumValidators, BigInt(n.totalStaked))
  // Positions, not people. Summing per-validator counts gives the number of open positions,
  // which is what delegationsCurrent holds. Comparing it against stakersCurrent is the exact
  // error this test caught on 2026-09-29: 1,014 positions against 884 addresses.
  const sumPositions = d.validators.reduce((a, v) => a + v.stakersCurrent, 0)
  check("sum of per-validator stakers", sumPositions, n.delegationsCurrent, "positions, not addresses")

  console.log("\n  Counts\n")
  console.log(`       validators indexed                 ${d.validators.length}`)
  console.log(`       active validators                  ${n.activeValidators}`)
  console.log(`       stakers, currently staking         ${n.stakersCurrent}   <- addresses`)
  console.log(`       stakers, ever                      ${n.stakersEver}`)
  console.log(`       positions currently open           ${n.delegationsCurrent}   <- pairs`)
  console.log(`       positions ever opened              ${n.delegationsEver}`)
  console.log(`       stakes                             ${n.stakeCount}`)
  console.log(`       withdrawals                        ${n.withdrawalCount}`)
  console.log(`       withdrawals outstanding            ${d.withdrawals.length}`)

  console.log(
    failures === 0
      ? "\n  every identity holds against the chain\n"
      : `\n  ${failures} check(s) FAILED\n`,
  )
  if (failures > 0) process.exitCode = 1
}

await main()
