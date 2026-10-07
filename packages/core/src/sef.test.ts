import { test } from "node:test"
import assert from "node:assert/strict"
import { SEF_DATA, SEF_DATA_REPO } from "./contracts.js"
import {
  PARTICIPATION_WINDOW_DAYS, REWARDS_LATEST_PATH, parseSefAmount, participationWindow, rewardProofPath, rewardProofUrl,
} from "./sef.js"

// An address made up for the test. Its first four bytes differ, so the radix path is checkable.
const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"

test("a proof URL fans out on the first four bytes of the lower-case address", () => {
  assert.equal(
    rewardProofUrl(ADDRESS),
    `${SEF_DATA.rewardsProofBase}/proofs/ab/cd/ef/01/${ADDRESS.toLowerCase()}.json`,
  )
})

test("a proof path is relative, so any rewards data base can carry it", () => {
  assert.equal(rewardProofPath(ADDRESS), `proofs/ab/cd/ef/01/${ADDRESS.toLowerCase()}.json`)
  assert.equal(rewardProofUrl(ADDRESS, "https://gw.example.org/ipfs/x"), `https://gw.example.org/ipfs/x/${rewardProofPath(ADDRESS)}`)
})

test("the repository's latest.json sits at the latest path under its rewards base", () => {
  assert.equal(SEF_DATA.rewardsLatest, `${SEF_DATA.rewardsProofBase}/${REWARDS_LATEST_PATH}`)
})

test("a proof URL does not depend on the address's checksum casing", () => {
  assert.equal(rewardProofUrl(ADDRESS), rewardProofUrl(ADDRESS.toLowerCase()))
})

test("a proof URL refuses something that is not an address", () => {
  assert.throws(() => rewardProofUrl("0x1234"))
  assert.throws(() => rewardProofUrl(`${ADDRESS}00`))
})

test("the participation window ends at the publish hour and spans 14 days", () => {
  const { start, end } = participationWindow(new Date("2026-10-04T21:12:45.123Z"))
  assert.equal(end.toISOString(), "2026-10-04T21:00:00.000Z")
  assert.equal(start.toISOString(), "2026-09-20T21:00:00.000Z")
  assert.equal(PARTICIPATION_WINDOW_DAYS, 14)
})

test("a publish exactly on the hour ends the window on that hour", () => {
  const { end } = participationWindow(new Date("2026-10-04T21:00:00.000Z"))
  assert.equal(end.toISOString(), "2026-10-04T21:00:00.000Z")
})

test("every SEF URL is built on the one repository name", () => {
  const urls = [
    SEF_DATA.validatorInfo,
    SEF_DATA.networkInfo,
    SEF_DATA.rewardsLatest,
    SEF_DATA.rewardsProofBase,
    SEF_DATA.validatorInfoCommits,
    SEF_DATA.networkInfoCommits,
    SEF_DATA.assetsAtCommit("abc1234"),
  ]
  for (const url of urls) assert.ok(url.includes(`/${SEF_DATA_REPO}/`), url)
})

test("the commit-pinned asset base names the commit", () => {
  assert.ok(SEF_DATA.assetsAtCommit("abc1234").includes("/abc1234/assets"))
})

test("SEF's staked total parses to the wei, with every decimal kept", () => {
  assert.equal(parseSefAmount("73352054.133956905730713929"), 73_352_054_133_956_905_730_713_929n)
  assert.equal(parseSefAmount("12.5"), 12_500_000_000_000_000_000n)
  assert.equal(parseSefAmount("7"), 7_000_000_000_000_000_000n)
})

test("an amount with more places than SAFE has, or not a number, is refused", () => {
  assert.throws(() => parseSefAmount("1.0000000000000000001"), /more than SAFE's 18/)
  assert.throws(() => parseSefAmount("1e18"), /not a decimal amount/)
  assert.throws(() => parseSefAmount("-1"), /not a decimal amount/)
})
