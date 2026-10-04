/**
 * Layer two of validation: the subgraph against the chain, and against the oracle.
 *
 * The matchstick tests prove each handler does what it is meant to, using hand-built events. They
 * cannot prove the event shapes, the addresses or the totals are right, because they never
 * touch a chain.
 *
 * This does. It reads the subgraph, reads the contracts directly, and asserts they agree.
 *
 * The three conservation identities, each already proven by metrics-poc.ts against live chains:
 *
 *   stakes minus withdrawals          == totalStakedAmount()
 *   initiated minus claimed           == totalPendingWithdrawals()
 *   allocated minus claimed           == the live MerkleDrop balance
 *
 * Usage: pnpm --filter @cobuilders/safenet-subgraph-mainnet differential
 */
import { createPublicClient, fallback, http } from "viem"
import { mainnet } from "viem/chains"
import { CONTRACTS, SEF_DATA, erc20Abi, merkleDropAbi, rpcUrls, stakingAbi } from "@cobuilders/safenet-core"

const PORT = process.env.GRAPH_NODE_PORT ?? "8000"
const ENDPOINT = `http://localhost:${PORT}/subgraphs/name/safenet/mainnet`

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(rpcUrls("mainnet").map((u) => http(u))),
})

// graph-node caps `first` at 1000. Every list is read in one page and asserted to be below
// the cap, so a list that outgrows it fails loudly instead of being summed short.
const PAGE = 1000

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

function underPage<T>(name: string, list: T[]): T[] {
  if (list.length >= PAGE) {
    throw new Error(`${name} returned ${list.length} rows, the page limit. Paginate before trusting any sum.`)
  }
  return list
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
  const deployed = CONTRACTS.staking.deployBlock
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
  const [totalStaked, pending] = await Promise.all([
    client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalStakedAmount", blockNumber: at }),
    client.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalPendingWithdrawals", blockNumber: at }),
  ])
  // The MerkleDrop deployed after Staking. Before its deploy block there is no code to read, and
  // merkleRoot() would fail with the same uninformative "0x".
  const dropLive = at >= CONTRACTS.merkleDrop.deployBlock
  const [dropBalance, chainRoot] = dropLive
    ? await Promise.all([
      client.readContract({ address: CONTRACTS.safeToken.address, abi: erc20Abi, functionName: "balanceOf", args: [CONTRACTS.merkleDrop.address], blockNumber: at }),
      client.readContract({ address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "merkleRoot", blockNumber: at }),
    ])
    : [0n, null]

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
    network(id: "1", block: { number: ${at} }) {
      totalStaked pendingWithdrawals rewardsClaimed
      activeValidators stakersCurrent stakersEver
      delegationsCurrent delegationsEver
      stakeCount withdrawalCount
      rewardPeriods currentRoot
    }
    validators(first: ${PAGE}, block: { number: ${at} }) { id totalStaked stakersCurrent }
    withdrawals(first: ${PAGE}, where: { claimed: false }, block: { number: ${at} }) { id }
    rewardPeriods(first: ${PAGE}, orderBy: period, block: { number: ${at} }) { id period root previousRoot cumulativeClaimedAtStart }
  }`)
  underPage("validators", d.validators)
  underPage("withdrawals", d.withdrawals)
  underPage("rewardPeriods", d.rewardPeriods)

  if (!d.network) throw new Error("no Network entity: the subgraph indexed no events")
  const n = d.network

  console.log("\n  the three conservation identities\n")
  check("stakes minus withdrawals", BigInt(n.totalStaked), totalStaked)
  check("initiated minus claimed", BigInt(n.pendingWithdrawals), pending)

  if (chainRoot === null) {
    console.log(`\n  block ${at} is before the MerkleDrop deploy at ${CONTRACTS.merkleDrop.deployBlock};`)
    console.log("  the rewards identity and the current root are not checked")
  } else {
    // The drop balance is what is left unclaimed, so allocated minus claimed. The subgraph holds
    // claimed. Allocated is SEF's tokenTotal for the current root, the same source metrics-poc.ts
    // uses. That figure belongs to SEF's LATEST root, so the identity only applies when the
    // chain's root at this block is that root. If it is not, the subgraph is behind SEF's latest
    // distribution, and that is a failure: let it sync and run again.
    const sef = (await (await fetch(SEF_DATA.rewardsLatest)).json()) as { merkleRoot: string; tokenTotal: string }
    const sameRoot = sef.merkleRoot.toLowerCase() === chainRoot.toLowerCase()
    check("SEF's latest root is the root here", sef.merkleRoot.toLowerCase(), chainRoot.toLowerCase(),
      sameRoot ? "" : "the subgraph is behind SEF's latest distribution; the identity below is skipped")
    if (sameRoot) {
      const allocated = BigInt(sef.tokenTotal)
      check("allocated minus claimed", allocated - BigInt(n.rewardsClaimed), dropBalance,
        "equals the MerkleDrop balance at this block")
    }

    console.log("\n  The reward root history\n")
    // The last root we indexed must be the root the contract reports now. If a distribution
    // were missed, this is where it shows: the chain would be ahead of us.
    check("current root", n.currentRoot ?? "none", chainRoot)
  }
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
