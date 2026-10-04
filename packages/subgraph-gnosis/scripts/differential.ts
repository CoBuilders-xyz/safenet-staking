/**
 * Layer two for Gnosis: the subgraph against the oracle.
 *
 * Mainnet could check itself against the contracts, because `totalStakedAmount()` is a live
 * read. Gnosis has no equivalent: participation is not stored on chain, it is computed from
 * events. So the only independent source is metrics-poc.ts, which scans the same events by a
 * different route and reproduces SEF's published figures bit-for-bit.
 *
 * Usage, run the oracle directly from packages/core (`pnpm metrics --days 2` drops the flags,
 * see below), then this script, close together in time:
 *   cd packages/core && node --env-file-if-exists=../../.env.local --import tsx \
 *     scripts/metrics-poc.ts --days 2 --json /tmp/oracle-2d.json
 *   ORACLE=/tmp/oracle-2d.json pnpm --filter @cobuilders/safenet-subgraph-gnosis differential
 *
 * The windows will not match exactly: the oracle aligns its window to SEF's publish instant
 * so the comparison measures the formula rather than the gap between runs, while the
 * subgraph indexes from whatever block the manifest names. So counts are
 * compared as ratios and orderings, not as equal integers. What must match exactly is the
 * ORDER of validators by participation. Each rate must agree within RATE_TOLERANCE.
 */
import { readFileSync } from "node:fs"

const PORT = process.env.GRAPH_NODE_PORT ?? "8000"
const ENDPOINT = `http://localhost:${PORT}/subgraphs/name/safenet/gnosis`
const ORACLE = process.env.ORACLE ?? "/tmp/oracle-2d.json"

// The oracle records the chain head at the moment it ran. The subgraph follows the head too, so
// the two heads differ by however long passed between the runs. 720 Gnosis blocks is about one
// hour at Gnosis's nominal 5s block time. Beyond that the windows have drifted apart enough that a
// rate disagreement says more about timing than about the handlers, so the check fails.
const MAX_BLOCK_OFFSET = 720

// Absolute difference allowed between the oracle's rate and the subgraph's, as a fraction:
// 0.01 is one percentage point. The two windows cover the same two days give or take a few
// hours at either edge, so a validator with steady participation lands well inside this. One
// that went offline inside a non-overlapping edge can exceed it; if that happens, regenerate
// both windows closer together before suspecting a handler. This bound is reasoned, not yet
// measured on a run.
const RATE_TOLERANCE = 0.01

interface OracleRun {
  gnosisBlock: string
  windowDays: number
  figures: Record<string, number | string>
  ceremonies: { all: number; attestations: number }
  participation: { label: string; address: string; ours: number; sef: number; rounds: number; absences: number }[]
}

interface SubgraphState {
  _meta: { block: { number: number } }
  consensus: {
    attestationCeremonies: string; nonAttestationCeremonies: string
    attestations: string; proposals: string; latencySamples: string
    openCeremonies: number; validatorCount: number
  } | null
  signingValidators: { id: string; attended: string }[]
}

async function query(): Promise<SubgraphState> {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `{
        _meta { block { number } }
        consensus(id: "1") {
          attestationCeremonies nonAttestationCeremonies attestations proposals
          latencySamples openCeremonies validatorCount
        }
        signingValidators(orderBy: attended, orderDirection: desc) { id attended }
      }`,
    }),
  })
  const j = (await r.json()) as { data?: SubgraphState; errors?: { message: string }[] }
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "))
  if (!j.data) throw new Error("no data")
  return j.data
}

let failures = 0
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(44)} ${detail}`)
}

async function main(): Promise<void> {
  const oracle = JSON.parse(readFileSync(ORACLE, "utf8")) as OracleRun
  const sg = await query()
  if (!sg.consensus) throw new Error("no Consensus entity: the subgraph indexed nothing")
  const c = sg.consensus

  // `pnpm metrics --days 2` does NOT work: pnpm appends arguments to the end of the whole
  // script string, and that script ends with `&& node render-metrics-report.mjs`, so the
  // flags reach the renderer. Run the script directly instead. This guard exists because
  // that mistake produced a 14-day file that looked like a 2-day one.
  const expectedDays = Number(process.env.ORACLE_DAYS ?? "2")
  if (oracle.windowDays !== expectedDays) {
    console.error(
      `\n  the oracle file covers ${oracle.windowDays} days, not ${expectedDays}.` +
      `\n  Regenerate it with:\n` +
      `    cd packages/core && node --env-file-if-exists=../../.env.local --import tsx \\\n` +
      `      scripts/metrics-poc.ts --days ${expectedDays} --json ${ORACLE}\n`,
    )
    process.exit(1)
  }

  const oracleHead = BigInt(oracle.gnosisBlock)
  const sgHead = BigInt(sg._meta.block.number)
  const offset = sgHead > oracleHead ? sgHead - oracleHead : oracleHead - sgHead
  console.log(`\n  oracle   ${oracle.windowDays} day window, gnosis head ${oracleHead}`)
  console.log(`  subgraph indexed to block ${sgHead}\n`)
  check(
    "oracle and subgraph heads are close",
    offset <= BigInt(MAX_BLOCK_OFFSET),
    `${offset} blocks apart, at most ${MAX_BLOCK_OFFSET} allowed`,
  )
  console.log()

  console.log("  Counts. The windows differ, so these are compared as shape, not equality.\n")
  console.log(`       oracle ceremonies, all            ${oracle.ceremonies.all}`)
  console.log(`       oracle ceremonies, attestations   ${oracle.ceremonies.attestations}`)
  console.log(`       subgraph attestation ceremonies   ${c.attestationCeremonies}`)
  console.log(`       subgraph non-attestation          ${c.nonAttestationCeremonies}`)
  console.log(`       subgraph still open               ${c.openCeremonies}`)

  const oracleFilterRate = oracle.ceremonies.attestations / oracle.ceremonies.all
  const sgAttest = Number(c.attestationCeremonies)
  const sgNon = Number(c.nonAttestationCeremonies)
  const sgFilterRate = sgAttest / (sgAttest + sgNon)
  // 0.1%, not 1%. The filter excludes about 1 ceremony in 400, which is 0.25%. A 1% window
  // let a subgraph reporting ZERO non-attestations pass as agreeing with one reporting 23.
  check(
    "attestation share of ceremonies agrees",
    Math.abs(oracleFilterRate - sgFilterRate) < 0.001,
    `oracle ${(oracleFilterRate * 100).toFixed(2)}%  subgraph ${(sgFilterRate * 100).toFixed(2)}%`,
  )
  check(
    "some ceremonies are non-attestations",
    sgNon > 0,
    `${sgNon} recorded; the oracle finds ${oracle.ceremonies.all - oracle.ceremonies.attestations}`,
  )

  console.log("\n  Validators. The set and its ORDER must match exactly.\n")
  const oracleOrder = [...oracle.participation].sort((a, b) => b.ours - a.ours)
  check("validator count", oracle.participation.length === sg.signingValidators.length,
    `oracle ${oracle.participation.length}  subgraph ${sg.signingValidators.length}`)

  const byAddress = new Map(oracle.participation.map((p) => [p.address.toLowerCase(), p]))
  console.log(`\n  Rates, each within ${RATE_TOLERANCE} of the oracle. oracle, subgraph, attended / ceremonies\n`)
  let orderOk = true
  for (let i = 0; i < sg.signingValidators.length; i++) {
    const v = sg.signingValidators[i]!
    const theirs = byAddress.get(v.id)
    const name = theirs?.label ?? v.id.slice(0, 10)
    const rate = Number(v.attended) / sgAttest
    const expected = oracleOrder[i]
    if (!expected || expected.address.toLowerCase() !== v.id) orderOk = false
    // A validator the oracle does not know has no rate to agree with, so it fails.
    const oracleRate = theirs ? theirs.ours : NaN
    check(
      name,
      Math.abs(oracleRate - rate) <= RATE_TOLERANCE,
      `${oracleRate.toFixed(6)}  ${rate.toFixed(6)}  ${v.attended} / ${sgAttest}`,
    )
  }
  console.log()
  check("validators rank in the same order", orderOk, "by participation, descending")

  console.log(
    failures === 0
      ? "\n  the subgraph agrees with the oracle\n"
      : `\n  ${failures} check(s) FAILED\n`,
  )
  if (failures > 0) process.exitCode = 1
}

await main()
