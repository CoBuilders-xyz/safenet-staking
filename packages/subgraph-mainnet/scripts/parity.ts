/**
 * Parity, Mainnet: the staked total from our subgraph against SEF's network-info.json, at the
 * instant SEF published it.
 *
 * The instant is the commit that last wrote the file. SEF's job reads the chain and then
 * commits, so the figure describes a block between the top of that hour and the commit:
 * sefRunSpan in packages/core. Ours is compared at the commit's block first, and at an earlier
 * block of the span only when SEF's figure equals the total there to the wei.
 *
 * The total at those blocks is rebuilt from the subgraph's own records, not read through
 * `block: { number }`: Studio prunes history to about 1,000 blocks, a few hours on Mainnet.
 * The Network row gives the total now, and the Stake and Withdrawal rows give every movement
 * since; totalsBetween in packages/core rewinds one through the other.
 *
 * network-info.json's other figure, total_transactions_checked, counts Gnosis activity; the
 * Gnosis package reports it.
 *
 *   pnpm --filter @cobuilders/safenet-subgraph-mainnet test:parity
 *   SUBGRAPH_URL_MAINNET=<query URL> pnpm --filter @cobuilders/safenet-subgraph-mainnet test:parity
 *
 * The states, from ParityState in packages/core:
 *   PASS            the total is SEF's, to the wei                                 exit 0
 *   FAIL            the total differs, the subgraph reports indexing errors or is
 *                   behind SEF's commit, SEF's file is over 24 hours old, or the
 *                   run hit an error                                               exit 1
 *   STALE           SEF's file is over 9 hours old; nothing is compared            exit 0
 *   NOT COMPARABLE  not reachable here: the stored movements rebuild any instant
 *                   since the deploy, whatever history the deployment keeps
 */
import { SEF_DATA, parseSefAmount, type SefNetworkInfo } from "@cobuilders/safenet-core"
import {
  EXIT_CODE, appendSummary, chainReader, compareStakedTotal, formatAge, freshness, githubToken, lastSefCommit,
  overall, querySubgraph, recordState, redact, renderMarkdown, renderText, sefAsset, sefRunSpan, staleOutcome,
  subgraphEndpoint, totalsBetween, type Movement, type ParityRow,
} from "@cobuilders/safenet-core/parity"

const TITLE = "Mainnet: the staked total against SEF's network-info.json"

// graph-node caps `first` at 1000. The movements since SEF's run are a few hours of a chain that
// sees about seven stakes a day, so one page is asserted rather than paginated.
const PAGE = 1000

function say(line = ""): void {
  console.log(line ? `  ${line}` : "")
}

async function main(): Promise<number> {
  say()
  say(TITLE)
  say()
  const gh = githubToken()
  say(`GitHub token   ${gh.source}`)

  const commit = await lastSefCommit(SEF_DATA.networkInfoCommits, gh.token)
  const fresh = freshness(commit.publishedAt, new Date())
  const published = `${commit.publishedAt.toISOString()} (commit ${commit.sha.slice(0, 7)}), ${formatAge(fresh.ageMs)} ago`
  say(`SEF published  ${published}`)

  const stale = staleOutcome(fresh, "network-info.json")
  if (stale) {
    say()
    say(stale.line)
    say()
    appendSummary(`### ${TITLE}: ${stale.state}\n\nSEF published ${published}.\n\n**${stale.line}**\n`)
    recordState("mainnet", stale.state, stale.line)
    return EXIT_CODE[stale.state]
  }

  const network = await sefAsset<SefNetworkInfo>(commit.sha, "network-info.json")
  const sef = parseSefAmount(network.total_staked_amount)

  const span = sefRunSpan(commit.publishedAt)
  const mainnet = chainReader("mainnet")
  const head = await mainnet.head()
  const [from, to] = await Promise.all([
    mainnet.blockAt(span.from, "last", head),
    mainnet.blockAt(span.to, "last", head),
  ])
  say(`SEF's run      ${span.from.toISOString()} .. ${span.to.toISOString()}`)
  say(`Mainnet blocks ${from} .. ${to}; SEF's commit is after block ${to}`)

  // One query, so the total and the movements come from the same indexed block.
  const d = await querySubgraph<{
    _meta: { block: { number: number }; deployment: string; hasIndexingErrors: boolean }
    network: { totalStaked: string } | null
    stakes: { amount: string; blockNumber: string }[]
    withdrawals: { amount: string; initiatedAtBlock: string }[]
  }>("mainnet", subgraphEndpoint("mainnet"), `{
    _meta { block { number } deployment hasIndexingErrors }
    network(id: "1") { totalStaked }
    stakes(first: ${PAGE}, where: { blockNumber_gt: "${from}" }) { amount blockNumber }
    withdrawals(first: ${PAGE}, where: { initiatedAtBlock_gt: "${from}" }) { amount initiatedAtBlock }
  }`)
  const indexed = BigInt(d._meta.block.number)
  say(`Subgraph       deployment ${d._meta.deployment}, indexed to block ${indexed}`)
  say()

  const refusals: string[] = []
  if (d._meta.hasIndexingErrors) refusals.push("the subgraph reports indexing errors")
  if (indexed < to) refusals.push(`the subgraph has indexed to block ${indexed}, before SEF's commit at block ${to}`)
  if (!d.network) refusals.push("the subgraph has no Network row: it indexed no stake")
  if (d.stakes.length >= PAGE || d.withdrawals.length >= PAGE) {
    throw new Error(`the movements since block ${from} reached the page limit of ${PAGE}`)
  }

  let rows: ParityRow[]
  if (refusals.length > 0 || !d.network) {
    rows = refusals.map((note) => ({ figure: "subgraph covers SEF's run", ours: "", sef: "", precision: "", verdict: "FAIL", note }))
  } else {
    const movements: Movement[] = [
      ...d.stakes.map((s) => ({ block: BigInt(s.blockNumber), delta: BigInt(s.amount) })),
      ...d.withdrawals.map((w) => ({ block: BigInt(w.initiatedAtBlock), delta: -BigInt(w.amount) })),
    ]
    const totals = totalsBetween({ at: indexed, total: BigInt(d.network.totalStaked), movements, from, to })
    say(`Movements      ${movements.length} since block ${from}, ${totals.length - 1} of them by SEF's commit`)
    say()
    rows = [compareStakedTotal(sef, totals, to)]
  }

  const result = overall(rows)
  const reason = result === "PASS" ? "the staked total is identical to SEF's, to the wei" : "see the rows marked FAIL"
  console.log(renderText(rows))
  say()
  say(`${result}: ${reason}`)
  say()
  recordState("mainnet", result, reason)
  appendSummary([
    `### ${TITLE}: ${result}`, "",
    `SEF published ${published}. SEF's run spans Mainnet blocks ${from} to ${to}. ` +
    `Subgraph deployment \`${d._meta.deployment}\`, indexed to block ${indexed}.`, "",
    "SEF writes the total in SAFE with all 18 decimals, so it is compared exactly, in wei.", "",
    renderMarkdown(rows), "", `**${result}**`, "",
  ].join("\n"))
  return EXIT_CODE[result]
}

main().then(
  (code) => { process.exitCode = code },
  (e: unknown) => {
    const message = redact(e instanceof Error ? e.message : String(e))
    console.error(`\n  ERROR: ${message}\n`)
    appendSummary(`### ${TITLE}: FAIL\n\n**ERROR:** ${message}\n`)
    recordState("mainnet", "FAIL", `ERROR: ${message}`)
    process.exitCode = EXIT_CODE.FAIL
  },
)
