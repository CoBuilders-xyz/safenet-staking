#!/usr/bin/env tsx
/**
 * Re-derive a snapshot's CID from its files, and compare.
 *
 *   snapshot:verify <directory> [--cid <cid>]
 *       Pack the directory with the release's settings and print the CID. With --cid, fail
 *       unless they are equal.
 *   snapshot:verify <cid> [--gateway <origin>]
 *       Fetch every file the snapshot's manifest lists through a gateway, pack them here, and
 *       fail unless they hash to <cid>. The gateways in packages/core are tried in order, or
 *       only --gateway. An index CID works the same way.
 *   snapshot:verify --index <index.json> --day <YYYY-MM-DD> [--gateway <origin>]
 *       Look the day up in an index file, then verify its CID as above.
 *
 * No secret and no account: anyone can run it. The gateway is not trusted, because any byte it
 * changes gives another CID.
 *
 * Usage: pnpm --filter @cobuilders/safenet-snapshots snapshot:verify <directory | cid>
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { IPFS_GATEWAYS } from "@cobuilders/safenet-core"
import { parseIndex } from "../date-index.js"
import { fetchSnapshot, verifyDirectory, type Verdict } from "../verify.js"
import { fail, run, sentence } from "./run.js"

const SCRIPT = "snapshot-verify"

function report(verdict: Verdict, expected: string | undefined, where: string): void {
  console.log(`${SCRIPT}: ${verdict.files.length} files from ${where}`)
  if (verdict.manifest !== null) console.log(`${SCRIPT}: manifest ${verdict.manifest}`)
  console.log(`${SCRIPT}: the files hash to ${verdict.derived}`)
  if (verdict.manifest !== null && verdict.manifest !== "lists exactly the files present") {
    throw new Error(`the manifest does not match the files: ${verdict.manifest}`)
  }
  if (expected === undefined) return
  if (!verdict.matches) throw new Error(`MISMATCH: expected ${expected}, the files hash to ${verdict.derived}`)
  console.log(`${SCRIPT}: OK, identical to ${expected}`)
}

run(SCRIPT, async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { cid: { type: "string" }, gateway: { type: "string" }, index: { type: "string" }, day: { type: "string" } },
  })
  const [target] = positionals

  if (target && existsSync(target) && statSync(target).isDirectory()) {
    report(await verifyDirectory(resolve(target), values.cid), values.cid, resolve(target))
    return
  }

  let cid = target
  if (values.index || values.day) {
    if (!values.index || !values.day) fail(SCRIPT, "--index and --day go together")
    const entry = parseIndex(readFileSync(values.index, "utf8")).days[values.day]
    if (!entry) fail(SCRIPT, `${values.index} has no snapshot for ${values.day}`)
    cid = entry.cid
    console.log(`${SCRIPT}: ${values.day} is ${cid} in ${values.index}`)
  }
  if (!cid) fail(SCRIPT, "give a snapshot directory, a CID, or --index and --day")

  const gateways = values.gateway ? [values.gateway.replace(/\/+$/, "")] : IPFS_GATEWAYS
  const errors: string[] = []
  for (const origin of gateways) {
    try {
      const dir = await fetchSnapshot(cid, origin)
      let verdict: Verdict
      try {
        verdict = await verifyDirectory(dir, cid)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
      report(verdict, cid, `${origin}/ipfs/${cid}`)
      return
    } catch (err) {
      errors.push(`${origin}: ${sentence(err)}`)
      console.error(`${SCRIPT}: ${origin} did not serve ${cid}: ${sentence(err)}`)
      continue
    }
  }
  fail(SCRIPT, `no gateway served ${cid}: ${errors.join("; ")}`)
})
