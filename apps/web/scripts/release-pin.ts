#!/usr/bin/env tsx
/**
 * Pin release/app.car to Pinata, then prove the gateways serve it.
 *
 * Run `pnpm --filter @cobuilders/safenet-web release:build` first. This script uploads the
 * CAR as a CAR, so Pinata stores the DAG that build produced and keeps its root CID. It fails
 * if Pinata reports any other CID. The upload and the gateway checks are the ones the daily
 * snapshots use, from `@cobuilders/safenet-snapshots/ipfs`.
 *
 * Then it checks each public gateway in IPFS_GATEWAYS from packages/core, and the dedicated
 * Pinata gateway when PINATA_GATEWAY is set. On each it waits for `/ipfs/<cid>/index.html` to answer 200, then fetches one
 * JavaScript file of the release, the smallest `.js` under `assets/`, and compares it byte for
 * byte with that file inside the CAR. The smallest, because a gateway fetches the file from the
 * network on first request: a large chunk drew several 504s before its 200. A pin no gateway serves is not a release, and a 200 with a
 * fallback page is not a pin being served.
 *
 * index.html proves only that the gateway answers, not what it serves: a gateway fronted by
 * Cloudflare injects a challenge script into every text/html response, so its index.html never
 * equals the release's. Cloudflare leaves JavaScript as it is stored, so the .js file proves
 * the content.
 *
 * The public list is the one the interface reads SEF's reward dataset through. Its comment
 * records when each gateway was last probed, and why the IPFS project's own public gateways are
 * not on it: they retired on 2026-09-21 and answer 429, so a check against them could never pass.
 *
 * The public gateways decide: the run fails when one of them does not serve the release. The
 * dedicated gateway is informational. Its result is printed, but it never fails the run, and it
 * gets at most two minutes: since 2026-11-18 Pinata answers 403 for every CID on a
 * `*.mypinata.cloud` host without a custom domain. Every gateway is checked to the end, and each
 * one's result is printed, before the run fails.
 *
 * PINATA_GATEWAY is a secret, so its host never reaches the log or the step summary. Output
 * names it "the dedicated Pinata gateway" and prints each public gateway URL in full.
 *
 * Required environment variable. Missing, it fails the run:
 *   PINATA_JWT       API JWT from https://app.pinata.cloud/developers/api-keys
 * Optional:
 *   PINATA_GATEWAY   dedicated gateway host, such as its custom domain. A URL works too; only its
 *                    host is used. Checked for information only.
 *   RELEASE_NAME             name shown in Pinata. Defaults to "safenet-staking <CID>".
 *   GATEWAY_TIMEOUT_SECONDS  retry window per gateway. Defaults to 900.
 *
 * Usage: pnpm --filter @cobuilders/safenet-web release:pin
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import {
  checkGateways, DEDICATED_GATEWAY_LABEL, failures, gatewaysToCheck, gatewayUrl, pinataCredentials, pinCar, probeAsset,
} from "@cobuilders/safenet-snapshots/ipfs"

const RELEASE = resolve(import.meta.dirname, "../release")

function fail(message: string): never {
  console.error(`release-pin: ${message}`)
  process.exit(1)
}

// --- Inputs ---
const credentials = pinataCredentials()
if (typeof credentials === "string") {
  fail(
    `${credentials}. The release is NOT pinned. ` +
      "In CI, add the repository secret PINATA_JWT, or run the workflow by hand, " +
      "which builds and verifies without publishing.",
  )
}

const carPath = join(RELEASE, "app.car")
const cidPath = join(RELEASE, "CID")
if (!existsSync(carPath) || !existsSync(cidPath)) {
  fail("release/app.car or release/CID is missing. Run release:build first.")
}
const cid = readFileSync(cidPath, "utf8").trim()
const timeoutMs = Number(process.env.GATEWAY_TIMEOUT_SECONDS ?? 900) * 1000
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("GATEWAY_TIMEOUT_SECONDS must be a positive number.")

// --- The file that proves a gateway serves this release ---
// Taken from the CAR that gets pinned, unpacked by the same ipfs-car. Its root CID is the one
// release:build wrote, so the file is the one in dist/.
const unpacked = mkdtempSync(join(tmpdir(), "release-pin-"))
let probe: string | undefined
let expected: Buffer | undefined
let unpackError: string | undefined
try {
  const root = join(unpacked, "root")
  execFileSync(
    process.execPath,
    [resolve(import.meta.dirname, "../node_modules/ipfs-car/bin.js"), "unpack", carPath, "--output", root],
    { stdio: "pipe" },
  )
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = join(entry.parentPath, entry.name)
      return { path: relative(root, full).split(sep).join("/"), size: statSync(full).size }
    })
  probe = probeAsset(files)
  if (probe) expected = readFileSync(join(root, probe))
} catch (err) {
  // A failed unpack carries ipfs-car's stderr, a Node crash report; its first `Error:` line
  // names the problem.
  const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? ""
  const reason = stderr.split("\n").find((line) => /^\w*Error\b/.test(line.trim()))?.trim()
  unpackError = reason || (err instanceof Error ? err.message.split("\n")[0] : String(err))
} finally {
  rmSync(unpacked, { recursive: true, force: true })
}
if (unpackError) fail(`release/app.car could not be unpacked: ${unpackError}. Run release:build again.`)
if (!probe || !expected) fail("the CAR holds no .js file under assets/ to compare the gateways against.")

// --- Pin ---
console.log(`release-pin: pinning ${cid} to Pinata`)
try {
  await pinCar(credentials, readFileSync(carPath), cid, {
    name: process.env.RELEASE_NAME?.trim() || `safenet-staking ${cid}`,
    fileName: "app.car",
  })
} catch (err) {
  fail(`${err instanceof Error ? err.message : String(err)}. The release is NOT pinned.`)
}
console.log(`release-pin: pinned ${cid}`)
// In GitHub Actions, the release smoke runs once the pin is confirmed, even when a gateway check
// below fails: the CID may still be served elsewhere, and its smoke says whether it works.
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "pinned=true\n")

// --- Gateways ---
const outcomes = await checkGateways(gatewaysToCheck(credentials), {
  cid,
  ready: "index.html",
  probe: probe!,
  expected: expected!,
  timeoutMs,
  redact: credentials.redact,
  log: (line) => console.log(`release-pin: ${line}`),
})
const state = ({ ok, informational }: { ok: boolean; informational?: boolean }) =>
  ok ? "OK" : informational ? "NOT SERVED (informational)" : "FAILED"
for (const outcome of outcomes) {
  const { label, ok, detail } = outcome
  const line = `release-pin: ${state(outcome)} ${label}: ${detail}`
  if (ok) console.log(line)
  else console.error(line)
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Pinned \`${cid}\``,
      "",
      ...outcomes.map((outcome) =>
        outcome.label === DEDICATED_GATEWAY_LABEL
          ? `- ${state(outcome)}: \`/ipfs/${cid}/index.html\` on the dedicated Pinata gateway. ${outcome.detail}`
          : `- ${state(outcome)}: ${gatewayUrl(outcome.label, cid, "index.html")}. ${outcome.detail}`,
      ),
      "",
    ].join("\n"),
  )
}

const failed = failures(outcomes).length
const required = outcomes.filter((o) => !o.informational).length
if (failed) fail(`${cid} is pinned, but ${failed} of ${required} public gateways did not serve it.`)
console.log(`release-pin: ${cid} is pinned and served by every public gateway`)
