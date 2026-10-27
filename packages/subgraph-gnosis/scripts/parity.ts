/**
 * Parity, Gnosis: participation per validator from our subgraph against SEF's
 * validator-info.json, over SEF's own window.
 *
 * SEF publishes `participation_rate_14d` for a 14-day window that ends at the top of the hour
 * its cron ran in. The instant is the commit that last wrote the file; participationWindow in
 * packages/core turns it into the window, and the window into its first and last Gnosis block.
 *
 * The subgraph files each attestation ceremony under the hour of the block it was attested in,
 * network-wide in ConsensusHour and per validator in ValidatorHour; the package's schema gives
 * the rules. SEF's window is then a sum of current rows: every hour from its start to the hour
 * before its end, plus the block exactly at its end, which each row counts apart. That gives
 * the attestation ceremonies completed in the window and, per validator, the ones it shared in,
 * which is SEF's numerator and denominator. The rate is then compared with SEF's double
 * exactly: it is the same division of the same integers.
 *
 * No query reaches back in time, so the comparison does not depend on how much history the
 * deployment keeps. Studio keeps about 1,000 blocks. A deployment built before the hourly
 * buckets has no rows to sum, and the run reports it as NOT COMPARABLE.
 *
 * This deployment indexes the programme GNOSIS_INDEXED_PROGRAMME in packages/core names, and SEF
 * computes its rates over the programme running when it publishes. A window that starts after
 * the indexed programme's last day holds no ceremony this deployment counts, so the run reports
 * NOT COMPARABLE with the reason, not a FAIL per validator: windowOutsideProgramme in
 * packages/core. A validator SEF lists with a null rate is NOT COMPARABLE too.
 *
 * The states, from ParityState in packages/core:
 *   PASS            every rate is SEF's double                                     exit 0
 *   FAIL            a rate differs, a validator is missing or extra, the subgraph
 *                   reports indexing errors or is behind the window, SEF's file is
 *                   over 24 hours old, or the run hit an error                     exit 1
 *   STALE           SEF's file is over 9 hours old; nothing is compared            exit 0
 *   NOT COMPARABLE  the deployment has no hourly buckets or starts after the window,
 *                   SEF's window lies after the programme it indexes, or SEF
 *                   publishes a null rate                                          exit 0
 *
 *   pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
 *   SUBGRAPH_URL_GNOSIS=<query URL> pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
 *
 * Without SUBGRAPH_URL_GNOSIS the run reads the default in packages/core, the Studio deployment
 * of this subgraph: subgraphEndpoint in packages/core resolves it, the same way for both chains.
 */
import {
  GNOSIS_INDEXED_PROGRAMME, SEF_DATA, SHARE_LOOKBACK_BLOCKS, participationWindow, type SefNetworkInfo, type SefValidator,
} from "@cobuilders/safenet-core"
import {
  EXIT_CODE, NEEDS_HOURLY_BUCKETS, appendSummary, chainReader, compareParticipation, formatAge, freshness,
  githubToken, lacksHourlyBuckets, lastSefCommit, notComparable, overall, participationFromHours, querySubgraph,
  recordState, redact, renderMarkdown, renderText, sefAsset, staleOutcome, subgraphEndpoint, windowOutsideProgramme,
  type ConsensusHourRow, type ParityRow, type ValidatorHourRow,
} from "@cobuilders/safenet-core/parity"

const TITLE = "Gnosis: participation per validator against SEF's validator-info.json"

// graph-node caps `first` at 1000. The hours are read in pages of that size.
const PAGE = 1000

/**
 * The window's counts, summed from the hourly rows: see participationFromHours in
 * packages/core. Every page reads the same block, `indexed`, so the rows come from one view of
 * the subgraph. That block is the head the deployment reported a moment ago, inside the history
 * any deployment keeps.
 *
 * Returns the reason line instead when the deployment has no hourly buckets.
 */
async function windowCounts(
  endpoint: string, indexed: bigint, window: { start: Date; end: Date },
): Promise<{ attended: Map<string, bigint>; ceremonies: bigint } | string> {
  const from = window.start.getTime() / 1000
  const to = window.end.getTime() / 1000
  const where = (after: string) => `where: { hour_gte: ${from}, hour_lte: ${to}, id_gt: "${after}" }`
  const page = async <T extends { id: string }>(entity: string, fields: string): Promise<T[]> => {
    const rows: T[] = []
    for (let after = ""; ;) {
      const q = await querySubgraph<Record<string, T[]>>("gnosis", endpoint, `{
        ${entity}(first: ${PAGE}, orderBy: id, orderDirection: asc, block: { number: ${indexed} }, ${where(after)}) {
          id ${fields}
        }
      }`)
      const got = q[entity]!
      rows.push(...got)
      if (got.length < PAGE) return rows
      after = got[got.length - 1]!.id
    }
  }
  let consensus: (ConsensusHourRow & { id: string })[]
  let validators: (Omit<ValidatorHourRow, "validator"> & { id: string; validator: { id: string } })[]
  try {
    consensus = await page("consensusHours", "hour attestationCeremonies attestationCeremoniesOnTheHour")
    validators = await page("validatorHours", "validator { id } hour attended attendedOnTheHour")
  } catch (e) {
    if (!lacksHourlyBuckets(e instanceof Error ? e.message : "")) throw e
    return `this deployment has no hourly buckets; ${NEEDS_HOURLY_BUCKETS}`
  }
  return participationFromHours({
    window,
    consensus,
    validators: validators.map((v) => ({ ...v, validator: v.validator.id })),
  })
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

  const commit = await lastSefCommit("gnosis", SEF_DATA.validatorInfoCommits, gh.token)
  const fresh = freshness(commit.publishedAt, new Date())
  const published = `${commit.publishedAt.toISOString()} (commit ${commit.sha.slice(0, 7)}), ${formatAge(fresh.ageMs)} ago`
  say(`SEF published  ${published}`)

  const stale = staleOutcome(fresh, "validator-info.json")
  if (stale) {
    say()
    say(stale.line)
    say()
    appendSummary(`### ${TITLE}: ${stale.state}\n\nSEF published ${published}.\n\n**${stale.line}**\n`)
    recordState("gnosis", stale.state, stale.line)
    return EXIT_CODE[stale.state]
  }

  const window = participationWindow(commit.publishedAt)
  const [sef, network] = await Promise.all([
    sefAsset<SefValidator[]>("gnosis", commit.sha, "validator-info.json"),
    sefAsset<SefNetworkInfo>("gnosis", commit.sha, "network-info.json"),
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

  // Refuse before comparing anything a refusal would explain. A broken or lagging subgraph is
  // ours to fix, so it fails; a deployment that starts too late is a known limit.
  const refusals: string[] = []
  if (meta._meta.hasIndexingErrors) refusals.push("the subgraph reports indexing errors")
  if (indexed < last) refusals.push(`the subgraph has indexed to block ${indexed}, before the window's last block ${last}`)
  // This deployment starts a fixed number of days before it was deployed; see this package's
  // CLAUDE.md. The window keeps moving forward, so this only stops a run right after a deploy.
  // A ceremony can complete inside the window with its shares emitted just before the start. The
  // subgraph counts a share when its ceremony completes, so it only needs to have indexed those
  // earlier blocks: SHARE_LOOKBACK_BLOCKS in packages/core, the look-back metrics-poc.ts uses.
  const earliest = meta.signingValidators[0] ? BigInt(meta.signingValidators[0].firstSeenBlock) : undefined
  const coverage = earliest === undefined || earliest > first - SHARE_LOOKBACK_BLOCKS
    ? `the deployment's first sight of a validator is at block ${earliest ?? "none"}, after block ${first - SHARE_LOOKBACK_BLOCKS}: ` +
      `it does not cover SEF's window with ${SHARE_LOOKBACK_BLOCKS} blocks of look-back, so it started too late to compare it`
    : undefined

  // SEF's window after the programme this deployment indexes: nothing to count, so nothing to
  // compare. A refusal above is still a FAIL and still wins.
  const outside = windowOutsideProgramme(window, GNOSIS_INDEXED_PROGRAMME)

  let rows: ParityRow[] = refusals.map((note) => ({
    figure: "subgraph covers the window", ours: "", sef: "", precision: "", verdict: "FAIL", note,
  }))
  if (refusals.length === 0 && outside) {
    rows = [notComparable("participation_rate_14d", outside)]
  } else if (refusals.length === 0 && coverage) {
    rows = [notComparable("participation_rate_14d", coverage)]
  } else if (refusals.length === 0) {
    const counted = await windowCounts(endpoint, indexed, window)
    if (typeof counted === "string") {
      rows = [notComparable("participation_rate_14d", counted)]
    } else {
      say(`Ceremonies     ${counted.ceremonies} attestation ceremonies completed in the window`)
      say()
      rows = compareParticipation({ sef, ...counted })
    }
  }

  // network-info.json's other figure is a count SEF keeps per programme, from its start: Aegis
  // Sentinel verdicts since SEF's data job moved to Aegis. Say why it is not compared rather than
  // leave it out of the table.
  rows.push({
    figure: "total_transactions_checked", ours: "", sef: String(network.total_transactions_checked),
    precision: "", verdict: "NOT COMPARED",
    note: "a count SEF keeps per programme, from the programme's start; this deployment does not hold it",
  })

  const result = overall(rows)
  const reason = result === "PASS"
    ? "every rate is identical to SEF's published double"
    : result === "NOT COMPARABLE"
      ? rows.find((r) => r.verdict === "NOT COMPARABLE")!.note!
      : "see the rows marked FAIL"
  console.log(renderText(rows))
  say()
  say(`${result}: ${reason}`)
  say()
  recordState("gnosis", result, reason)
  appendSummary([
    `### ${TITLE}: ${result}`, "",
    `SEF published ${published}. Window ${window.start.toISOString()} to ${window.end.toISOString()}, ` +
    `Gnosis blocks ${first} to ${last}. Subgraph deployment \`${meta._meta.deployment}\`, indexed to block ${indexed}.`, "",
    "Rates are compared exactly: SEF publishes the double, and ours is the same division of the same integers, " +
    "summed from the hourly buckets.", "",
    renderMarkdown(rows), "", `**${result}: ${reason}**`, "",
  ].join("\n"))
  return EXIT_CODE[result]
}

main().then(
  (code) => { process.exitCode = code },
  (e: unknown) => {
    const message = redact(e instanceof Error ? e.message : String(e))
    console.error(`\n  ERROR: ${message}\n`)
    appendSummary(`### ${TITLE}: FAIL\n\n**ERROR:** ${message}\n`)
    recordState("gnosis", "FAIL", `ERROR: ${message}`)
    process.exitCode = EXIT_CODE.FAIL
  },
)
