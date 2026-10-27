#!/usr/bin/env tsx
/**
 * Publish a day built by `snapshot:build`: pack it into a CAR, pin it to Pinata, prove the
 * gateways serve it, then add it to the date index and pin the index the same way.
 *
 * The path is the interface's release path: the CAR is packed with the release's settings and
 * uploaded as a CAR, so Pinata keeps the CID built here, and each gateway must serve one file of
 * the DAG byte for byte, here `manifest.json`, before the day counts as published. A day already
 * in the index is not pinned again and the index does not change, unless `--replace` is given,
 * which only the preview index of a pull request uses.
 *
 * The new index is written to `<out>/index/index.json`, its CID to `<out>/INDEX_CID` and the
 * day's CID to `<out>/CID`. The workflow commits the first two to the index branch.
 *
 * Required environment variables. Missing ones fail the run; nothing is skipped:
 *   PINATA_JWT       API JWT from https://app.pinata.cloud/developers/api-keys
 *   PINATA_GATEWAY   dedicated gateway host. A URL works too; only its host is used.
 * Optional:
 *   GATEWAY_TIMEOUT_SECONDS  retry window per gateway. Defaults to 900.
 *
 * Usage:
 *   pnpm --filter @cobuilders/safenet-snapshots snapshot:publish --dir <day> --out <dir> \
 *     [--index <dir holding the current index.json and INDEX_CID>] [--replace]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { addDay, emptyIndex, parseIndex, type IndexEntry, type SnapshotIndex } from "../date-index.js"
import {
  checkGateways, DEDICATED_GATEWAY_LABEL, gatewaysToCheck, gatewayUrl, packDirectory, pinataCredentials, pinCar,
  type Outcome, type PinataCredentials,
} from "../ipfs/index.js"
import { serialise, manifestMismatch } from "../write.js"
import { fail, output, run } from "./run.js"

const SCRIPT = "snapshot-publish"

interface Manifest {
  schema: string
  day: string
  mainnet: { block: string; timestamp: string }
  gnosis: { block: string }
  build: { commit: string | null }
}

function summary(lines: string[]): void {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n\n`)
}

function describe(cid: string, outcomes: readonly Outcome[], probe: string): string[] {
  return outcomes.map(({ label, ok, detail }) =>
    label === DEDICATED_GATEWAY_LABEL
      ? `- ${ok ? "OK" : "FAILED"}: \`/ipfs/${cid}/${probe}\` on the dedicated Pinata gateway. ${detail}`
      : `- ${ok ? "OK" : "FAILED"}: ${gatewayUrl(label, cid, probe)}. ${detail}`)
}

/** Pack, pin, and prove every gateway serves `probe`. Fails the run when any gateway does not. */
async function publish(credentials: PinataCredentials, dir: string, name: string, probe: string, what: string): Promise<string> {
  const packed = await packDirectory(dir)
  console.log(`${SCRIPT}: ${what}: ${packed.files.length} files, ${packed.blocks} blocks, CID ${packed.cid}`)
  await pinCar(credentials, packed.car, packed.cid, { name, fileName: `${basename(dir)}.car` })
  console.log(`${SCRIPT}: ${what}: pinned ${packed.cid}`)
  const timeoutMs = Number(process.env.GATEWAY_TIMEOUT_SECONDS ?? 900) * 1000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail(SCRIPT, "GATEWAY_TIMEOUT_SECONDS must be a positive number")
  const outcomes = await checkGateways(gatewaysToCheck(credentials), {
    cid: packed.cid,
    probe,
    expected: readFileSync(join(dir, probe)),
    timeoutMs,
    redact: credentials.redact,
    log: (line) => console.log(`${SCRIPT}: ${line}`),
  })
  for (const { label, ok, detail } of outcomes) {
    const line = `${SCRIPT}: ${ok ? "OK" : "FAILED"} ${label}: ${detail}`
    if (ok) console.log(line)
    else console.error(line)
  }
  summary([`### ${what}: \`${packed.cid}\``, "", ...describe(packed.cid, outcomes, probe)])
  const failed = outcomes.filter((o) => !o.ok).length
  if (failed) fail(SCRIPT, `${what} ${packed.cid} is pinned, but ${failed} of ${outcomes.length} gateways did not serve it`)
  return packed.cid
}

run(SCRIPT, async () => {
  const { values } = parseArgs({
    options: { dir: { type: "string" }, out: { type: "string" }, index: { type: "string" }, replace: { type: "boolean" } },
  })
  if (!values.dir || !values.out) fail(SCRIPT, "--dir and --out are required")
  const dir = resolve(values.dir)
  const out = resolve(values.out)

  const mismatch = manifestMismatch(dir)
  if (mismatch) fail(SCRIPT, `${dir} is not a complete snapshot: ${mismatch}. Nothing was pinned`)
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest
  if (basename(dir) !== manifest.day) fail(SCRIPT, `${dir} holds the snapshot of ${manifest.day}; the directory must be named after its day`)

  // The current index and the CID it was pinned under, from the index branch, when there is one.
  const indexFile = values.index ? join(values.index, "index.json") : undefined
  const current: SnapshotIndex = indexFile && existsSync(indexFile) ? parseIndex(readFileSync(indexFile, "utf8")) : emptyIndex()
  const cidFile = values.index ? join(values.index, "INDEX_CID") : undefined
  const previous = cidFile && existsSync(cidFile) ? readFileSync(cidFile, "utf8").trim() || null : null
  if (Object.keys(current.days).length > 0 && previous === null) fail(SCRIPT, "the index has days but no INDEX_CID beside it")

  const existing = current.days[manifest.day]
  if (existing && !values.replace) {
    console.log(`${SCRIPT}: ${manifest.day} is already published as ${existing.cid}. Nothing was pinned, and the index is unchanged`)
    summary([`### ${manifest.day} already published`, "", `Snapshot \`${existing.cid}\`, index \`${previous}\`. Nothing was pinned.`])
    output("status", "already published")
    output("cid", existing.cid)
    output("index_cid", previous ?? "")
    return
  }

  const credentials = pinataCredentials()
  if (typeof credentials === "string") {
    fail(SCRIPT, `${credentials}. The snapshot is NOT pinned. In CI, add the repository secrets PINATA_JWT and PINATA_GATEWAY`)
  }

  const cid = await publish(credentials, dir, `safenet-snapshot ${manifest.day} ${manifest.mainnet.block}`, "manifest.json", `Snapshot ${manifest.day}`)

  const entry: IndexEntry = {
    cid,
    schema: manifest.schema,
    mainnetBlock: manifest.mainnet.block,
    gnosisBlock: manifest.gnosis.block,
    blockTime: new Date(Number(manifest.mainnet.timestamp) * 1000).toISOString(),
    commit: manifest.build.commit,
  }
  const update = addDay(current, previous, manifest.day, entry, { replace: values.replace === true })
  if (update.kind === "already published") fail(SCRIPT, `${manifest.day} was published as ${update.cid} while this run pinned`)

  const indexDir = join(out, "index")
  rmSync(indexDir, { recursive: true, force: true })
  mkdirSync(indexDir, { recursive: true })
  writeFileSync(join(indexDir, "index.json"), serialise(update.index))
  const indexCid = await publish(credentials, indexDir, `safenet-snapshots index ${manifest.day}`, "index.json", "Index")
  writeFileSync(join(out, "CID"), `${cid}\n`)
  writeFileSync(join(out, "INDEX_CID"), `${indexCid}\n`)

  const how = update.kind === "replaced" ? `replaced ${update.was} in the preview index` : "added to the index"
  console.log(`${SCRIPT}: ${manifest.day} ${cid}, ${how}; index ${indexCid}`)
  summary([
    `### Published ${manifest.day}`,
    "",
    `- Snapshot CID: \`${cid}\``,
    `- Index CID: \`${indexCid}\`, which names the previous index ${previous ? `\`${previous}\`` : "as none"}`,
    `- Mainnet block ${manifest.mainnet.block}, Gnosis block ${manifest.gnosis.block}`,
    `- ${how}`,
  ])
  output("status", update.kind)
  output("cid", cid)
  output("index_cid", indexCid)
})
