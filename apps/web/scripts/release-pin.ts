#!/usr/bin/env tsx
/**
 * Pin release/app.car to Pinata, then prove two public gateways serve it.
 *
 * Run `pnpm --filter @cobuilders/safenet-web release:build` first. This script uploads the
 * CAR as a CAR, so Pinata stores the DAG that build produced and keeps its root CID. It fails
 * if Pinata reports any other CID.
 *
 * Then it fetches index.html through the Pinata gateway and through dweb.link, and fails
 * unless both answer 200 with the index.html inside the CAR, within the retry window. A pin no
 * gateway serves is not a release, and a 200 with a fallback page is not a pin being served.
 *
 * PINATA_GATEWAY is a secret, so its host never reaches the log or the step summary. Output
 * names it "the dedicated Pinata gateway" and prints the dweb.link URL in full.
 *
 * Required environment variables. Missing ones fail the run; nothing is skipped:
 *   PINATA_JWT       API JWT from https://app.pinata.cloud/developers/api-keys
 *   PINATA_GATEWAY   dedicated gateway domain, e.g. "example.mypinata.cloud"
 * Optional:
 *   RELEASE_NAME             name shown in Pinata. Defaults to "safenet-staking <CID>".
 *   GATEWAY_TIMEOUT_SECONDS  retry window per gateway. Defaults to 900.
 *
 * Usage: pnpm --filter @cobuilders/safenet-web release:pin
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { PinataSDK } from "pinata"

const RELEASE = resolve(import.meta.dirname, "../release")

function fail(message: string): never {
  console.error(`release-pin: ${message}`)
  process.exit(1)
}

// --- Inputs ---
const jwt = process.env.PINATA_JWT?.trim()
const gateway = process.env.PINATA_GATEWAY?.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")
if (!jwt || !gateway) {
  const missing = [!jwt && "PINATA_JWT", !gateway && "PINATA_GATEWAY"].filter(Boolean)
  fail(
    `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} empty. The release is NOT pinned. ` +
      "In CI, add the repository secrets PINATA_JWT and PINATA_GATEWAY, or run the workflow with pin=false " +
      "to build and verify without publishing.",
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

// --- Pin ---
const pinata = new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway })
console.log(`release-pin: pinning ${cid} to Pinata`)
const upload = await pinata.upload.public
  .file(new File([readFileSync(carPath)], "app.car"))
  .car()
  .name(process.env.RELEASE_NAME?.trim() || `safenet-staking ${cid}`)
if (upload.cid !== cid) {
  fail(`Pinata stored ${upload.cid}, not ${cid}. The pinned DAG is not the one built here.`)
}
console.log(`release-pin: pinned ${cid}`)

// --- Gateways ---
// The expected index.html comes from the CAR that was pinned, unpacked by the same ipfs-car.
const unpacked = mkdtempSync(join(tmpdir(), "release-pin-"))
execFileSync(process.execPath, [
  resolve(import.meta.dirname, "../node_modules/ipfs-car/bin.js"),
  "unpack", carPath, "--output", join(unpacked, "root"),
])
const expectedIndex = readFileSync(join(unpacked, "root", "index.html"))
rmSync(unpacked, { recursive: true, force: true })

const dwebUrl = `https://${cid}.ipfs.dweb.link/index.html`
const gateways = [
  { label: "the dedicated Pinata gateway", url: `https://${gateway}/ipfs/${cid}/index.html` },
  { label: dwebUrl, url: dwebUrl },
]

async function waitFor200({ label, url }: { label: string; url: string }): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = "no answer"
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) })
      if (res.status === 200) {
        // The path is immutable: a 200 with other bytes will not get better with retries.
        if (!Buffer.from(await res.arrayBuffer()).equals(expectedIndex)) {
          fail(`${label} answered 200 with a body that is not the release's index.html.`)
        }
        console.log(`release-pin: 200 from ${label} with the release's index.html (attempt ${attempt})`)
        return
      }
      await res.body?.cancel()
      last = `HTTP ${res.status}`
    } catch (err) {
      last = (err instanceof Error ? err.message : String(err)).replaceAll(gateway!, "<gateway>")
    }
    if (Date.now() + 15_000 > deadline) {
      fail(`${label} did not return 200 within ${timeoutMs / 1000} s. Last: ${last}.`)
    }
    console.log(`release-pin: ${label}: ${last}, retrying in 15 s`)
    await new Promise((r) => setTimeout(r, 15_000))
  }
}

await Promise.all(gateways.map(waitFor200))

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Pinned \`${cid}\``,
      "",
      `- ${dwebUrl}`,
      `- \`/ipfs/${cid}/index.html\` on the dedicated Pinata gateway`,
      "",
    ].join("\n"),
  )
}
console.log(`release-pin: ${cid} is pinned and served by both gateways`)
