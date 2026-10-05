/**
 * Parity, Gnosis: participation per validator from our subgraph against SEF's
 * validator-info.json, over SEF's own window.
 *
 * SEF publishes `participation_rate_14d` for a 14-day window that ends at the top of the hour
 * its cron ran in. The instant is the commit that last wrote the file; participationWindow in
 * packages/core turns it into the window, and the window into its first and last Gnosis block.
 *
 * The subgraph keeps running counters, and a deployment that keeps its history answers for any
 * block it has indexed. So the window is one subtraction: a counter at the last block of the window minus the same counter at the
 * block before the first. That gives the attestation ceremonies completed in the window and,
 * per validator, the ones it shared in, which is SEF's numerator and denominator. The rate is
 * then compared with SEF's double exactly: it is the same division of the same integers.
 *
 *   pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
 *   SUBGRAPH_URL_GNOSIS=<query URL> pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
 *
 * Exit 0 on PASS and on STALE, 1 on FAIL, on an error, and when SEF's file is a day old.
 */
import { SEF_DATA, participationWindow, type SefNetworkInfo, type SefValidator } from "@cobuilders/safenet-core"
import {
  appendSummary, chainReader, compareParticipation, formatAge, freshness, githubToken, lastSefCommit, overall,
  prunedFrom, querySubgraph, redact, renderMarkdown, renderText, sefAsset, subgraphEndpoint, type ParityRow,
} from "@cobuilders/safenet-core/parity"

const TITLE = "Gnosis: participation per validator against SEF's validator-info.json"

// A ceremony can complete inside the window with its shares emitted just before the start. The
// subgraph counts a share when its ceremony completes, so it only needs to have indexed those
// earlier blocks. 200 blocks is metrics-poc.ts's look-back: measured over 2,148 ceremonies on
// 2026-09-03, the span from first share to completion had a median of 1 block and a max of 10.
const SHARE_LOOKBACK = 200n

// graph-node caps `first` at 1000. The list is asserted below the cap rather than paginated:
// Safenet has six validators.
const PAGE = 1000

interface Counters {
  consensus: { attestationCeremonies: string } | null
  signingValidators: { id: string; attended: string }[]
}

/**
 * The window's counts: each counter after its last block minus the same counter after the block
 * before its first. One query, so both reads come from the same view of the subgraph.
 *
 * Returns a sentence instead when the deployment no longer holds the history: a pruned
 * deployment answers only for its last blocks, and SEF's window starts 14 days back.
 */
async function windowCounts(
  endpoint: string, first: bigint, last: bigint,
): Promise<{ attended: Map<string, bigint>; ceremonies: bigint } | string> {
  const counters = (prefix: string, block: bigint) => `
    ${prefix}Consensus: consensus(id: "1", block: { number: ${block} }) { attestationCeremonies }
    ${prefix}Validators: signingValidators(first: ${PAGE}, block: { number: ${block} }) { id attended }`
  let q: {
    endConsensus: Counters["consensus"]; endValidators: Counters["signingValidators"]
    beforeConsensus: Counters["consensus"]; beforeValidators: Counters["signingValidators"]
  }
  try {
    q = await querySubgraph("gnosis", endpoint, `{ ${counters("end", last)} ${counters("before", first - 1n)} }`)
  } catch (e) {
    const kept = prunedFrom(e instanceof Error ? e.message : "")
    if (kept === undefined) throw e
    return `the deployment prunes its history and answers from block ${kept} only; ` +
      `SEF's window needs block ${first - 1n}, ${kept - first + 1n} blocks earlier`
  }
  if (q.endValidators.length >= PAGE || q.beforeValidators.length >= PAGE) {
    throw new Error(`signingValidators reached the page limit of ${PAGE}`)
  }
  const before = new Map(q.beforeValidators.map((v) => [v.id, BigInt(v.attended)]))
  return {
    attended: new Map(q.endValidators.map((v) => [v.id, BigInt(v.attended) - (before.get(v.id) ?? 0n)])),
    ceremonies:
      BigInt(q.endConsensus?.attestationCeremonies ?? "0") - BigInt(q.beforeConsensus?.attestationCeremonies ?? "0"),
  }
}

function say(line = ""): void {
  console.log(line ? `  ${line}` : "")
}

async function main(): Promise<number> {
  say()
  say(TITLE)
  say()
  const gh = githubToken()
  say(`GitHub token   ${gh.source}`)

  const commit = await lastSefCommit(SEF_DATA.validatorInfoCommits, gh.token)
  const fresh = freshness(commit.publishedAt, new Date())
  const published = `${commit.publishedAt.toISOString()} (commit ${commit.sha.slice(0, 7)}), ${formatAge(fresh.ageMs)} ago`
  say(`SEF published  ${published}`)

  if (fresh.state !== "fresh") {
    const expired = fresh.state === "expired"
    const line = expired
      ? `FAIL: SEF's data is stale. validator-info.json was last written ${formatAge(fresh.ageMs)} ago, ` +
        `more than ${SEF_DATA.expiredAfterMs / 3_600_000} h: SEF's update job has stopped.`
      : `STALE: validator-info.json was last written ${formatAge(fresh.ageMs)} ago, more than ` +
        `${SEF_DATA.staleAfterMs / 3_600_000} h. Not compared, and not a failure.`
    say()
    say(line)
    say()
    appendSummary(`### ${TITLE}\n\nSEF published ${published}.\n\n**${line}**\n`)
    return expired ? 1 : 0
  }

  const window = participationWindow(commit.publishedAt)
  const [sef, network] = await Promise.all([
    sefAsset<SefValidator[]>(commit.sha, "validator-info.json"),
    sefAsset<SefNetworkInfo>(commit.sha, "network-info.json"),
  ])

  const gnosis = chainReader("gnosis")
  const head = await gnosis.head()
  const [first, last] = await Promise.all([
    gnosis.blockAt(window.start, "first", head),
    gnosis.blockAt(window.end, "last", head),
  ])
  say(`SEF's window   ${window.start.toISOString()} .. ${window.end.toISOString()}`)
  say(`Gnosis blocks  ${first} .. ${last}, both inclusive`)

  const endpoint = subgraphEndpoint("gnosis")
  const meta = await querySubgraph<{
    _meta: { block: { number: number }; deployment: string; hasIndexingErrors: boolean }
    signingValidators: { firstSeenBlock: string }[]
  }>("gnosis", endpoint, `{
    _meta { block { number } deployment hasIndexingErrors }
    signingValidators(first: 1, orderBy: firstSeenBlock, orderDirection: asc) { firstSeenBlock }
  }`)
  const indexed = BigInt(meta._meta.block.number)
  say(`Subgraph       deployment ${meta._meta.deployment}, indexed to block ${indexed}`)
  say()

  // Refuse before comparing anything a refusal would explain.
  const refusals: string[] = []
  if (meta._meta.hasIndexingErrors) refusals.push("the subgraph reports indexing errors")
  if (indexed < last) refusals.push(`the subgraph has indexed to block ${indexed}, before the window's last block ${last}`)
  // This deployment starts a fixed number of days before it was deployed; see this package's
  // CLAUDE.md. The window keeps moving forward, so this only fails right after a deploy.
  const earliest = meta.signingValidators[0] ? BigInt(meta.signingValidators[0].firstSeenBlock) : undefined
  if (earliest === undefined || earliest > first - SHARE_LOOKBACK) {
    refusals.push(
      `the subgraph's first share is at block ${earliest ?? "none"}, after block ${first - SHARE_LOOKBACK}: ` +
      `the deployment does not cover SEF's window with ${SHARE_LOOKBACK} blocks of look-back`,
    )
  }

  let rows: ParityRow[] = refusals.map((note) => ({
    figure: "subgraph covers the window", ours: "", sef: "", precision: "", verdict: "FAIL", note,
  }))
  if (refusals.length === 0) {
    const counted = await windowCounts(endpoint, first, last)
    if (typeof counted === "string") {
      rows = [{ figure: "subgraph answers for the window", ours: "", sef: "", precision: "", verdict: "FAIL", note: counted }]
    } else {
      say(`Ceremonies     ${counted.ceremonies} attestation ceremonies completed in the window`)
      say()
      rows = compareParticipation({ sef, ...counted })
    }
  }

  // network-info.json's other figure counts Gnosis activity from the deploy. Say why it is not
  // compared rather than leave it out of the table.
  rows.push({
    figure: "total_transactions_checked", ours: "", sef: String(network.total_transactions_checked),
    precision: "", verdict: "NOT COMPARED",
    note: "a count from the contract's deploy; this deployment indexes from a later block",
  })

  const result = overall(rows)
  console.log(renderText(rows))
  say()
  say(`${result}: ${result === "PASS" ? "every rate is identical to SEF's published double" : "see the rows marked FAIL"}`)
  say()
  appendSummary([
    `### ${TITLE}`, "",
    `SEF published ${published}. Window ${window.start.toISOString()} to ${window.end.toISOString()}, ` +
    `Gnosis blocks ${first} to ${last}. Subgraph deployment \`${meta._meta.deployment}\`, indexed to block ${indexed}.`, "",
    "Rates are compared exactly: SEF publishes the double, and ours is the same division of the same integers.", "",
    renderMarkdown(rows), "", `**${result}**`, "",
  ].join("\n"))
  return result === "PASS" ? 0 : 1
}

main().then(
  (code) => { process.exitCode = code },
  (e: unknown) => {
    const message = redact(e instanceof Error ? e.message : String(e))
    console.error(`\n  ERROR: ${message}\n`)
    appendSummary(`### ${TITLE}\n\n**ERROR:** ${message}\n`)
    process.exitCode = 1
  },
)
