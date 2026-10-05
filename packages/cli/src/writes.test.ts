import { test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, maxUint256 } from "viem"
import { mnemonicToAccount, toAccount } from "viem/accounts"
import { run } from "./cli.js"
import { localSigner, type Signer } from "./lib/index.js"
import {
  CLAIMABLE, fakeRoot, fakeRuntime, STAKER, TEST_MNEMONIC, TX_HASH, VALIDATOR_A, type FakeOptions,
} from "./test-support.js"

// The write commands end to end, against the fake chain in test-support.ts. Nothing touches the
// network. The fork suite in src/fork/ runs the same commands against the real contracts.

const SAFE = 10n ** 18n
const testAccount = mnemonicToAccount(TEST_MNEMONIC)
const TEST_KEY = bytesToHex(testAccount.getHdKey().privateKey!)
const KEY_ENV = { SAFENET_TEST_KEY: TEST_KEY }

async function cli(argv: string[], options: FakeOptions = {}) {
  const rt = fakeRuntime(options)
  const code = await run(argv, rt)
  return { code, out: rt.stdout(), err: rt.stderr(), sends: rt.sends }
}

/**
 * A signer for STAKER whose every signing method throws, and counts the attempt. Reaching it is
 * the failure the dry-run test exists to catch.
 */
function tripwire() {
  const reached: string[] = []
  const trip = (what: string) => {
    reached.push(what)
    throw new Error(`the signer was reached: ${what}`)
  }
  const account = toAccount({
    address: STAKER,
    signMessage: async () => trip("signMessage"),
    signTransaction: async () => trip("signTransaction"),
    signTypedData: async () => trip("signTypedData"),
  })
  const loadSigner: NonNullable<FakeOptions["loadSigner"]> = async (_request, ctx): Promise<Signer> =>
    localSigner(ctx.client, account)
  return { reached, loadSigner }
}

/** Every write command, with arguments the fake chain lets succeed. */
const WRITES: readonly (readonly string[])[] = [
  ["stake", VALIDATOR_A, "1"],
  ["stake", VALIDATOR_A, "1", "--approve", "unlimited"],
  ["unstake", VALIDATOR_A, "0.5"],
  ["withdrawals", "claim", "1"],
  ["withdrawals", "claim", "--all"],
  ["rewards", "claim"],
  ["rewards", "claim-and-stake", VALIDATOR_A],
  ["rewards", "claim-and-stake", VALIDATOR_A, "--amount", "0.25"],
]

// --- the dry-run proof ---------------------------------------------------------

test("--dry-run runs every write command to the end and never reaches the signer", async () => {
  for (const argv of WRITES) {
    for (const extra of [[], ["--json"]]) {
      const { reached, loadSigner } = tripwire()
      const r = await cli([...argv, "--dry-run", "--private-key-env", "SAFENET_TEST_KEY", ...extra], { env: KEY_ENV, loadSigner })
      const what = [...argv, ...extra].join(" ")
      assert.equal(r.code, 0, `${what}: ${r.err}`)
      assert.deepEqual(reached, [], `${what} reached the signer`)
      assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 }, `${what} prepared or broadcast a transaction`)
      if (extra.length) {
        const data = JSON.parse(r.out) as { dryRun: boolean; steps: { gas: { value: string }; transaction: unknown; data: string }[] }
        assert.equal(data.dryRun, true)
        assert.ok(data.steps.length > 0, what)
        for (const step of data.steps) {
          assert.equal(step.transaction, null, what)
          assert.match(step.gas.value, /^\d+$/, what)
          assert.match(step.data, /^0x[0-9a-f]{8}/, what)
        }
      } else {
        assert.match(r.out, /nothing signed or sent/, what)
      }
    }
  }
})

test("the tripwire signer is reached when --dry-run is left out, so the test above can fail", async () => {
  const { reached, loadSigner } = tripwire()
  const r = await cli(["stake", VALIDATOR_A, "1", "--private-key-env", "SAFENET_TEST_KEY"], { env: KEY_ENV, loadSigner })
  assert.equal(r.code, 1)
  assert.deepEqual(reached, ["signTransaction"])
})

test("--dry-run --from simulates from an address with no signer at all", async () => {
  for (const argv of WRITES) {
    const r = await cli([...argv, "--dry-run", "--from", STAKER])
    assert.equal(r.code, 0, `${argv.join(" ")}: ${r.err}`)
    assert.match(r.out, new RegExp(`from ${STAKER}`))
  }
})

// --- what a dry run reports ------------------------------------------------------

test("stake approves only when the allowance is short, exact by default", async () => {
  const short = JSON.parse((await cli(["stake", VALIDATOR_A, "1", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.deepEqual(short.steps.map((s: { function: string }) => s.function.split("(")[0]), ["approve", "stake"])
  assert.equal(short.steps[0].args.amount, String(SAFE))
  assert.equal(short.steps[0].gas.source, "eth_estimateGas")
  assert.match(short.steps[1].gas.source, /^eth_simulateV1, gas used after step 1/)
  assert.deepEqual(short.amount, { wei: String(SAFE), safe: "1" })

  const unlimited = JSON.parse((await cli(["stake", VALIDATOR_A, "1", "--approve", "unlimited", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.equal(unlimited.steps[0].args.amount, String(maxUint256))
  assert.equal(unlimited.approval.kind, "unlimited")

  const covered = JSON.parse((await cli(["stake", VALIDATOR_A, "1", "--dry-run", "--from", STAKER, "--json"], { allowance: 5n * SAFE })).out)
  assert.deepEqual(covered.steps.map((s: { function: string }) => s.function.split("(")[0]), ["stake"])
  assert.equal(covered.approval, null)
})

test("withdrawals claim --all claims what is past its delay and names what is not", async () => {
  const r = await cli(["withdrawals", "claim", "--all", "--dry-run", "--from", STAKER])
  assert.equal(r.code, 0)
  assert.match(r.out, /Would claim 1 withdrawal, 5 SAFE in total/)
  assert.match(r.out, /Not yet claimable: id 2 \(2 SAFE, at /)
  const data = JSON.parse((await cli(["withdrawals", "claim", "--all", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.deepEqual(data.claimed.map((w: { id: string }) => w.id), ["1"])
  assert.deepEqual(data.notYetClaimable.map((w: { id: string }) => w.id), ["2"])
})

test("withdrawals claim refuses an id still in its delay, or not in the queue, in one sentence", async () => {
  const early = await cli(["withdrawals", "claim", "2", "--dry-run", "--from", STAKER])
  assert.equal(early.code, 1)
  assert.match(early.err, /^error: Withdrawal 2 is not claimable yet: it is in its delay until .* UTC\.\n$/)
  const missing = await cli(["withdrawals", "claim", "9", "--dry-run", "--from", STAKER])
  assert.equal(missing.code, 1)
  assert.match(missing.err, /has no pending withdrawal with id 9; its pending ids are 1, 2\./)
})

test("rewards claim reads what arrived from the simulated SAFE Transfer log", async () => {
  const data = JSON.parse((await cli(["rewards", "claim", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.equal(data.claim.claimable.value.wei, String(CLAIMABLE))
  assert.equal(data.claim.received.value.wei, String(CLAIMABLE))
  assert.match(data.claim.received.source, /Transfer logs .* simulated claim/)
  assert.equal(data.steps[0].args.account, STAKER)
})

test("claim-and-stake stakes what arrived, or --amount when it is lower", async () => {
  const all = JSON.parse((await cli(["rewards", "claim-and-stake", VALIDATOR_A, "--dry-run", "--from", STAKER, "--json"])).out)
  assert.equal(all.staked.wei, String(CLAIMABLE))
  assert.deepEqual(all.steps.map((s: { function: string }) => s.function.split("(")[0]), ["claim", "approve", "stake"])
  const less = JSON.parse((await cli(["rewards", "claim-and-stake", VALIDATOR_A, "--amount", "0.25", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.equal(less.staked.wei, String(SAFE / 4n))
  const more = JSON.parse((await cli(["rewards", "claim-and-stake", VALIDATOR_A, "--amount", "500", "--dry-run", "--from", STAKER, "--json"])).out)
  assert.equal(more.staked.wei, String(CLAIMABLE))
})

// --- refusals and decoded reverts --------------------------------------------------

test("a stale proof, a missing proof and a short balance are refused in one sentence, exit 1", async () => {
  const cases: [string[], FakeOptions, RegExp][] = [
    [["rewards", "claim"], { chainRoot: fakeRoot(0x2) }, /^error: SEF's proof for .* is stale: it was written for Merkle root .*, the MerkleDrop now holds .*\.\n$/],
    [["rewards", "claim-and-stake", VALIDATOR_A], { proof: null }, /^error: SEF published no reward proof for .*, so it has no rewards to claim\.\n$/],
    [["rewards", "claim"], { proof: { cumulativeAmount: String(10n * SAFE), merkleRoot: fakeRoot(0x1), proof: [] } }, /has already claimed all 10 SAFE/],
    [["stake", VALIDATOR_A, "100"], {}, /holds 40 SAFE, less than the 100 SAFE to stake\.\n$/],
    [["stake", STAKER, "1"], {}, /is not a registered validator on the staking contract\.\n$/],
    [["unstake", VALIDATOR_A, "5"], {}, /has 1 SAFE staked on .*, less than the 5 SAFE to unstake\.\n$/],
  ]
  for (const [argv, options, expected] of cases) {
    const r = await cli([...argv, "--dry-run", "--from", STAKER], options)
    assert.equal(r.code, 1, argv.join(" "))
    assert.equal(r.out, "")
    assert.match(r.err, expected, argv.join(" "))
  }
})

test("a revert is decoded from core's ABIs into one sentence, by eth_call and by eth_simulateV1", async () => {
  const cases: [string[], NonNullable<FakeOptions["revert"]>, string][] = [
    [["unstake", VALIDATOR_A, "0.5"], { functionName: "initiateWithdrawal", errorName: "InsufficientStake" },
      "Staking.initiateWithdrawal would revert with InsufficientStake: the stake on that validator is less than the amount."],
    [["rewards", "claim"], { functionName: "claim", errorName: "MerkleRootWasUpdated" },
      "MerkleDrop.claim would revert with MerkleRootWasUpdated: the Merkle root on chain changed after the proof was read, so the proof is stale."],
    [["withdrawals", "claim", "1"], { functionName: "claimWithdrawal", errorName: "NoClaimableWithdrawal" },
      "Staking.claimWithdrawal would revert with NoClaimableWithdrawal: the oldest pending withdrawal is still in its delay."],
    // The stake follows its approval, so it is simulated with eth_simulateV1.
    [["stake", VALIDATOR_A, "1"], { functionName: "stake", errorName: "NotValidator" },
      "Staking.stake would revert with NotValidator: the address is not a registered validator."],
  ]
  for (const [argv, revert, sentence] of cases) {
    const r = await cli([...argv, "--dry-run", "--from", STAKER], { revert })
    assert.equal(r.code, 1, argv.join(" "))
    assert.equal(r.err, `error: ${sentence}\n`)
  }
})

// --- signing -------------------------------------------------------------------

test("without --dry-run and without a signer option, a write exits 2 with one sentence", async () => {
  for (const argv of WRITES) {
    const r = await cli([...argv])
    assert.equal(r.code, 2, argv.join(" "))
    assert.equal(
      r.err,
      "error: Sending a transaction needs a signer: pass --private-key-env <NAME> or --keystore <path>, or use --dry-run\n",
    )
    assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
  }
})

test("signer and amount options are checked before anything is read, exit 2", async () => {
  const bare = TEST_KEY.slice(2)
  const cases: [string[], RegExp, FakeOptions?][] = [
    [["stake", VALIDATOR_A, "1", "--private-key-env", TEST_KEY], /takes the name of an environment variable/],
    [["stake", VALIDATOR_A, "1", "--private-key-env", bare], /takes the name of an environment variable/],
    [["stake", VALIDATOR_A, "1", "--private-key-env", "NOT_SET"], /The environment variable NOT_SET is not set/],
    [["stake", VALIDATOR_A, "1", "--private-key-env", "BAD"], /BAD does not hold a private key/, { env: { BAD: "0x1234" } }],
    [["stake", VALIDATOR_A, "1", "--private-key-env", "K", "--keystore", "k.json"], /cannot be used together/],
    [["stake", VALIDATOR_A, "1", "--from", STAKER], /--from only works with --dry-run/],
    [["stake", VALIDATOR_A, "1", "--dry-run"], /A dry run needs an address to simulate from/],
    [["stake", VALIDATOR_A, "1", "--dry-run", "--private-key-env", "SAFENET_TEST_KEY", "--from", STAKER], /is not the signer's address/, { env: KEY_ENV }],
    [["stake", VALIDATOR_A, "0", "--dry-run", "--from", STAKER], /The amount must be more than zero/],
    [["stake", VALIDATOR_A, "1.0000000000000000001", "--dry-run", "--from", STAKER], /with at most 18 decimals/],
    [["stake", VALIDATOR_A, "ten", "--dry-run", "--from", STAKER], /is not a SAFE amount/],
    [["stake", VALIDATOR_A, "1", "--approve", "max", "--dry-run", "--from", STAKER], /--approve takes "exact" or "unlimited"/],
    [["withdrawals", "claim", "--dry-run", "--from", STAKER], /Name a withdrawal id, or pass --all/],
    [["withdrawals", "claim", "1", "--all", "--dry-run", "--from", STAKER], /not both/],
    [["withdrawals", "claim", "first", "--dry-run", "--from", STAKER], /is not a withdrawal id/],
  ]
  for (const [argv, expected, options] of cases) {
    const r = await cli(argv, options)
    assert.equal(r.code, 2, argv.join(" "))
    assert.match(r.err, expected, argv.join(" "))
    assert.ok(!r.err.includes(bare), `${argv.join(" ")} printed the key`)
  }
})

test("a live write signs with the key from the environment, reports each hash, and never prints the key", async () => {
  const r = await cli(["stake", VALIDATOR_A, "1", "--private-key-env", "SAFENET_TEST_KEY"], { env: KEY_ENV })
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.sends, { prepared: 2, broadcast: 2 })
  assert.match(r.out, new RegExp(`from ${testAccount.address}`))
  assert.match(r.out, new RegExp(`sent +${TX_HASH}, block 26,000,001, status success`))
  assert.match(r.err, new RegExp(`^sent SAFE token.approve: ${TX_HASH}, waiting for its receipt\n`))
  assert.match(r.err, /confirmed Staking.stake: .* status success/)
  for (const text of [r.out, r.err]) assert.ok(!text.includes(TEST_KEY.slice(2)))
})

test("live claim-and-stake reports what arrived before it stakes, and stakes that amount", async () => {
  const r = await cli(
    ["rewards", "claim-and-stake", VALIDATOR_A, "--private-key-env", "SAFENET_TEST_KEY", "--json"],
    { env: KEY_ENV, proofAccount: testAccount.address },
  )
  assert.equal(r.code, 0, r.err)
  const lines = r.err.trim().split("\n")
  const received = lines.findIndex((l) => l.startsWith("received 2 SAFE (2000000000000000000 wei)"))
  const approve = lines.findIndex((l) => l.startsWith("sent SAFE token.approve"))
  assert.ok(received > 0 && received < approve, r.err)
  const data = JSON.parse(r.out)
  assert.equal(data.staked.wei, String(CLAIMABLE))
  assert.deepEqual(data.steps.map((s: { transaction: { status: string } }) => s.transaction.status), ["success", "success", "success"])
})

test("a step that fails after another confirmed names the confirmed one", async () => {
  const r = await cli(
    ["rewards", "claim-and-stake", VALIDATOR_A, "--private-key-env", "SAFENET_TEST_KEY"],
    { env: KEY_ENV, proofAccount: testAccount.address, revert: { functionName: "stake", errorName: "NotValidator" } },
  )
  assert.equal(r.code, 1)
  assert.match(
    r.err,
    new RegExp(`error: Staking.stake would revert with NotValidator: .*; already confirmed, and not undone: MerkleDrop.claim in ${TX_HASH}, SAFE token.approve in ${TX_HASH}\\.\n$`),
  )
})

test("a sent transaction whose receipt never comes is reported with its hash, not as a failure to send", async () => {
  const r = await cli(["unstake", VALIDATOR_A, "0.5", "--private-key-env", "SAFENET_TEST_KEY"], { env: KEY_ENV, receiptTimeout: true })
  assert.equal(r.code, 1)
  assert.match(r.err, new RegExp(`error: Staking.initiateWithdrawal was sent in ${TX_HASH}, but its receipt could not be read \\(Timed out .*\\); look the hash up before sending again\\.\n$`))
})

test("--keystore with --password-env signs as the keystore's account", async () => {
  const path = new URL("./fixtures/keystore-anvil-1.json", import.meta.url).pathname
  const r = await cli(
    ["stake", VALIDATOR_A, "1", "--dry-run", "--keystore", path, "--password-env", "PW", "--json"],
    { env: { PW: "safenet fixture" } },
  )
  assert.equal(r.code, 0, r.err)
  assert.equal(JSON.parse(r.out).from, mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }).address)
  const wrong = await cli(
    ["stake", VALIDATOR_A, "1", "--dry-run", "--keystore", path, "--password-env", "PW"],
    { env: { PW: "not it" } },
  )
  assert.equal(wrong.code, 1)
  assert.equal(wrong.err, "error: The keystore password is wrong: the file's MAC does not match.\n")
  const noTerminal = await cli(["stake", VALIDATOR_A, "1", "--keystore", path])
  assert.equal(noTerminal.code, 2)
  assert.match(noTerminal.err, /--keystore needs its password/)
})
