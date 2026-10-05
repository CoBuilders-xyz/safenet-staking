import { test } from "node:test"
import assert from "node:assert/strict"
import { errorSentence, run } from "./cli.js"
import { SafenetError } from "./lib/index.js"
import { fakeRoot, fakeRuntime, STAKER, VALIDATOR_A, VALIDATOR_B } from "./test-support.js"

// Every command runs end to end here, against the fake chain and fake SEF files in
// test-support.ts. Nothing touches the network.

async function cli(argv: string[], options: Parameters<typeof fakeRuntime>[0] = {}) {
  const rt = fakeRuntime(options)
  const code = await run(argv, rt)
  return { code, out: rt.stdout(), err: rt.stderr() }
}

// --- exit codes --------------------------------------------------------------

test("--help and --version exit 0", async () => {
  assert.equal((await cli(["--help"])).code, 0)
  assert.equal((await cli(["--version"])).code, 0)
})

test("an unknown command or option exits 2", async () => {
  assert.equal((await cli(["nope"])).code, 2)
  assert.equal((await cli(["status", "--nope"])).code, 2)
})

test("a missing argument exits 2", async () => {
  const r = await cli(["rewards", "check"])
  assert.equal(r.code, 2)
  assert.match(r.err, /missing required argument/)
})

test("a group without a subcommand prints its help and exits 2", async () => {
  const r = await cli(["validators"])
  assert.equal(r.code, 2)
  assert.match(r.err, /Usage: safenet validators/)
})

test("an invalid value exits 2 with one line on stderr and nothing on stdout", async () => {
  for (const argv of [
    ["validators", "show", "0x12"],
    ["validators", "list", "--active", "--all"],
    ["validators", "list", "--sort", "name"],
    ["withdrawals", "list", "--address", "nope"],
    ["--rpc-url", "not a url", "status"],
  ]) {
    const r = await cli(argv)
    assert.equal(r.code, 2, argv.join(" "))
    assert.equal(r.out, "")
    assert.equal(r.err.trim().split("\n").length, 1, argv.join(" "))
    assert.match(r.err, /^error: /)
  }
})

test("a failed operation exits 1 with one sentence and no URL", async () => {
  const rpcError = new Error(
    "HTTP request failed.\n\nURL: https://archive.invalid/v2/not-a-real-key\nRequest body: {}",
  )
  const r = await cli(["status"], { rpcError })
  assert.equal(r.code, 1)
  assert.equal(r.out, "")
  assert.equal(r.err, "error: HTTP request failed.\n")
  assert.ok(!r.err.includes("not-a-real-key"))
})

test("a SEF file that lost a field exits 1 with a sentence that names the file", async () => {
  const noRoot = await cli(["status"], { rewardsLatest: { epoch: 0, tokenTotal: "1" } })
  assert.equal(noRoot.code, 1)
  assert.equal(noRoot.err, "error: SEF's rewards/latest.json no longer has the shape this tool reads.\n")
  const noTotal = await cli(["status"], { networkInfo: { total_transactions_checked: 1 } })
  assert.equal(noTotal.code, 1)
  assert.equal(noTotal.err, "error: SEF's network-info.json no longer has the shape this tool reads.\n")
})

test("a validator that SEF does not list and the chain does not know exits 1", async () => {
  const r = await cli(["validators", "show", STAKER])
  assert.equal(r.code, 1)
  assert.match(r.err, /is not a validator/)
})

test("errorSentence keeps the first line, removes URLs and ends with a period", () => {
  assert.equal(errorSentence(new SafenetError("Could not reach SEF")), "Could not reach SEF.")
  assert.equal(
    errorSentence(new Error("failed at https://archive.invalid/key?x=1 today\nsecond line")),
    "failed at <url> today.",
  )
  assert.equal(errorSentence("plain string!"), "plain string!")
})

// --- output ----------------------------------------------------------------

test("status prints every figure with its source and a root line", async () => {
  const r = await cli(["status"])
  assert.equal(r.code, 0)
  assert.match(r.out, /SAFE staked\s+300 SAFE\s+chain: Staking\.totalStakedAmount\(\)/)
  assert.match(r.out, /Rewards allocated\s+50 SAFE\s+SEF: rewards\/latest\.json tokenTotal/)
  assert.match(r.out, /Rewards unclaimed\s+40 SAFE\s+chain: SAFE\.balanceOf\(MerkleDrop\)/)
  assert.match(r.out, /Registered validators\s+2 of 2 listed/)
  assert.match(r.out, /Merkle root: match\./)
})

test("status says differs when the chain root is not the published one", async () => {
  const r = await cli(["status"], { chainRoot: fakeRoot(0x2) })
  assert.match(r.out, /Merkle root: differs\./)
})

test("status --json carries the same figures, amounts in wei as strings", async () => {
  const r = await cli(["status", "--json"])
  const s = JSON.parse(r.out)
  assert.deepEqual(s.totalStaked, { value: "300000000000000000000", source: "chain: Staking.totalStakedAmount()" })
  assert.equal(s.block, "26000000")
  assert.equal(s.merkleRoot.match, true)
  for (const key of ["totalStaked", "totalStakedPublished", "activeValidators", "pendingWithdrawals",
    "rewardsAllocated", "rewardsUnclaimed"]) {
    assert.match(s[key].source, /^(chain|SEF): /, key)
  }
})

test("validators list states the window next to the rate and keeps active ones by default", async () => {
  const r = await cli(["validators", "list"])
  assert.equal(r.code, 0)
  assert.match(r.out, /^Participation: 14-day window, 2026-09-20 21:00 UTC to 2026-10-04 21:00 UTC/)
  assert.match(r.out, /PARTICIPATION \(14d\)/)
  assert.match(r.out, /Alpha/)
  assert.doesNotMatch(r.out, /Beta/)
})

test("validators list --all --sort participation puts the higher rate first", async () => {
  const r = await cli(["validators", "list", "--all", "--sort", "participation", "--json"])
  const list = JSON.parse(r.out)
  assert.deepEqual(list.validators.map((v: { label: string }) => v.label), ["Beta", "Alpha"])
  assert.equal(list.validators[0].stake, "100000000000000000000")
  assert.equal(list.window.days, 14)
  assert.equal(list.window.end, "2026-10-04T21:00:00.000Z")
})

test("an unknown window is reported, never guessed", async () => {
  const r = await cli(["validators", "list"], { githubStatus: 403 })
  assert.equal(r.code, 0)
  assert.match(r.out, /window ending at SEF's last publish; its time is unknown because the GitHub API answered HTTP 403/)
})

test("validators show gives the delegators count and the window", async () => {
  const r = await cli(["validators", "show", VALIDATOR_A, "--json"])
  const d = JSON.parse(r.out)
  assert.deepEqual(d.delegators.value, { current: 1, ever: 1 })
  assert.equal(d.validator.participation, 0.9765)
  const text = (await cli(["validators", "show", VALIDATOR_B])).out
  assert.match(text, /Participation \(14d\)\s+99\.996%/)
  assert.match(text, /^Participation: 14-day window/m)
})

test("validators show still prints when the endpoint refuses the delegators scan", async () => {
  const r = await cli(["validators", "show", VALIDATOR_A], { logsRefused: true })
  assert.equal(r.code, 0)
  assert.match(r.out, /Delegators\s+unavailable, see below/)
  assert.match(r.out, /^Delegators: The RPC endpoint refused StakeIncreased logs/m)
  const j = JSON.parse((await cli(["validators", "show", VALIDATOR_A, "--json"], { logsRefused: true })).out)
  assert.equal(j.delegators.value, null)
  assert.match(j.delegators.unavailableBecause, /archive endpoint/)
})

test("a refused scan elsewhere fails the command with one sentence", async () => {
  const r = await cli(["rewards", "history", STAKER], { logsRefused: true })
  assert.equal(r.code, 1)
  assert.match(r.err, /^error: The RPC endpoint refused Claimed logs .* archive endpoint\.\n$/)
})

test("withdrawals list without an address gives the network total, count and a check", async () => {
  const r = await cli(["withdrawals", "list"])
  assert.match(r.out, /Total pending\s+7 SAFE/)
  assert.match(r.out, /Count pending\s+1\s/)
  assert.match(r.out, /Check: the 1 open withdrawals in the logs sum to the total on chain\./)
  const j = JSON.parse((await cli(["withdrawals", "list", "--json"])).out)
  assert.equal(j.scope, "network")
  assert.equal(j.logsMatchChain, true)
})

test("withdrawals list --address shows each withdrawal against the block time", async () => {
  const r = await cli(["withdrawals", "list", "--address", STAKER])
  assert.match(r.out, /5 SAFE\s+\S+ \S+ UTC\s+claimable now/)
  assert.match(r.out, /2 SAFE\s+\S+ \S+ UTC\s+in 1d 1h/)
  assert.match(r.out, /2 pending, 7 SAFE in total/)
})

test("rewards check gives claimable, claimed and kycAmount, and a matching root", async () => {
  const r = await cli(["rewards", "check", STAKER])
  assert.match(r.out, /Earned to date\s+12 SAFE/)
  assert.match(r.out, /Claimed\s+10 SAFE/)
  assert.match(r.out, /Claimable\s+2 SAFE/)
  assert.match(r.out, /kycAmount\s+0 SAFE/)
  assert.match(r.out, /Proof: match\./)
})

test("rewards check says stale proof when the proof's root is not on chain", async () => {
  const r = await cli(["rewards", "check", STAKER], { chainRoot: fakeRoot(0x2) })
  assert.match(r.out, /Proof: stale proof\./)
  const j = JSON.parse((await cli(["rewards", "check", STAKER, "--json"], { chainRoot: fakeRoot(0x2) })).out)
  assert.equal(j.root.status, "stale proof")
})

test("rewards check reports held amounts until the address passes the checks", async () => {
  const held = { cumulativeAmount: "5", kycAmount: "3", kyc: false, merkleRoot: fakeRoot(0x1), proof: [] }
  assert.equal(JSON.parse((await cli(["rewards", "check", STAKER, "--json"], { proof: held })).out).heldPendingCompliance, "3")
  const passed = { ...held, kyc: true }
  assert.equal(JSON.parse((await cli(["rewards", "check", STAKER, "--json"], { proof: passed })).out).heldPendingCompliance, "0")
})

test("rewards check says plainly when an address never earned", async () => {
  const r = await cli(["rewards", "check", STAKER], { proof: null })
  assert.equal(r.code, 0)
  assert.match(r.out, /Never earned: SEF published no reward proof for this address/)
  assert.equal(JSON.parse((await cli(["rewards", "check", STAKER, "--json"], { proof: null })).out).earned, false)
})

test("rewards history lists claims newest first and checks them against the chain", async () => {
  const r = await cli(["rewards", "history", STAKER])
  assert.match(r.out, /2 claims, newest first\./)
  assert.match(r.out, /Claimed in total: 10 SAFE, equal to chain: MerkleDrop\.cumulativeClaimed\(address\)\./)
  const j = JSON.parse((await cli(["rewards", "history", STAKER, "--json", "--all"])).out)
  assert.deepEqual(j.claims.map((c: { amount: string }) => c.amount), ["4000000000000000000", "6000000000000000000"])
  assert.equal(j.limited, false)
  assert.equal(j.sumMatchesChain, true)
})
