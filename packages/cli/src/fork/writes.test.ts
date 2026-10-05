/**
 * The five write commands, sent for real against the Safenet contracts on an Anvil fork of
 * Mainnet, each checked by reading the chain. Then every command again with --dry-run, which must
 * leave the chain exactly as it was and never reach a signer.
 *
 *   pnpm --filter @cobuilders/safenet-cli test:fork
 *
 * Runs only under that script, which sets SAFENET_FORK_SUITE. There it needs MAINNET_RPC_URL, an
 * archive endpoint, from the environment or .env.local, and fails without one. Anywhere else,
 * such as `pnpm test`, each test is skipped with the reason.
 *
 * The commands run in process through `run()`, the same program as the binary, with `--rpc-url`
 * pointing at Anvil. Two things are injected, and only these: SEF's proof files are read at the
 * commit pinned next to the fork block, and the rewards claims are signed by Anvil for a real
 * address it impersonates, whose key nobody has. Stake, unstake and the withdrawal claims sign
 * with a private key read from the environment, through the CLI's own signer.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, formatUnits, maxUint256, parseEther, type Address, type Hex } from "viem"
import { mnemonicToAccount, toAccount } from "viem/accounts"
import { stakingAbi } from "@cobuilders/safenet-core"
import { run, type Runtime } from "../cli.js"
import { loadSigner } from "../commands/signer.js"
import { createContext, localSigner, type Signer } from "../lib/index.js"
import { TEST_MNEMONIC } from "../test-support.js"
import { cliAnvilPort, startAnvil, type Anvil } from "./anvil.js"
import {
  STAKING, activeValidator, allowance, claimed, findRewardsClaimer, forkClients, fundSafe, impersonate,
  impersonatedSigner, pending, pinnedFetch, redactUrls, safeBalance, stakeOf, warp, withdrawDelay,
  type ForkClients, type RewardsClaimer,
} from "./chain.js"

const inSuite = process.env.SAFENET_FORK_SUITE === "1"
const skip = inSuite ? false : "the fork suite runs only with `pnpm --filter @cobuilders/safenet-cli test:fork`"
const TIMEOUT = 180_000

const user = mnemonicToAccount(TEST_MNEMONIC)
const USER_KEY = bytesToHex(user.getHdKey().privateKey!)
const KEY_ENV = "SAFENET_FORK_KEY"

let anvil: Anvil | undefined
let c: ForkClients
let validator: Address
let claimer: RewardsClaimer

before(async () => {
  if (!inSuite) return
  const forkUrl = process.env.MAINNET_RPC_URL
  if (!forkUrl) {
    throw new Error("MAINNET_RPC_URL is not set. The fork suite forks an archive endpoint; run `pnpm env:pull`, or export it.")
  }
  anvil = await startAnvil(forkUrl, cliAnvilPort(), (line) => process.stderr.write(`${line}\n`))
  try {
    c = forkClients(anvil.url)
    validator = await activeValidator(c)
    claimer = await findRewardsClaimer(forkUrl)
    await c.test.setBalance({ address: user.address, value: parseEther("100") })
    await fundSafe(c, user.address, parseEther("100"))
  } catch (err) {
    // Anvil's own log, URLs removed, says which request to the archive endpoint it was waiting on.
    process.stderr.write(`Anvil's last output:\n${anvil.logTail()}\n`)
    // A fresh error, without viem's fields and cause chain, any of which can carry the fork URL.
    throw new Error(redactUrls(err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err)))
  }
}, { timeout: TIMEOUT })

after(async () => {
  await anvil?.stop()
})

/** How a command signs: the CLI's own key loading, an impersonated address, or a tripwire. */
type SignWith = "env key" | Signer | ((client: Parameters<typeof localSigner>[0]) => Signer)

async function safenet(argv: string[], signWith: SignWith = "env key") {
  let out = ""
  let err = ""
  const env = { [KEY_ENV]: USER_KEY }
  const runtime: Runtime = {
    io: { out: (t) => void (out += t), err: (t) => void (err += t) },
    env,
    createContext: (options) => ({ ...createContext(options), fetch: pinnedFetch, retryDelayMs: 0 }),
    loadSigner: async (request, ctx) =>
      signWith === "env key"
        ? loadSigner(request, ctx, { env, askPassword: undefined })
        : typeof signWith === "function" ? signWith(ctx.client) : signWith,
  }
  const code = await run(["--rpc-url", anvil!.url, ...argv, "--private-key-env", KEY_ENV, "--json"], runtime)
  // stderr carries one sentence on failure and the hashes as they land; no URL, no key.
  assert.ok(!err.includes(USER_KEY.slice(2)) && !out.includes(USER_KEY.slice(2)), "the key was printed")
  return { code, err, json: code === 0 ? (JSON.parse(out) as Record<string, unknown> & { steps: Step[] }) : null }
}

interface Step {
  function: string
  args: Record<string, string>
  transaction: { hash: Hex; status: string } | null
}

function ok(r: Awaited<ReturnType<typeof safenet>>, what: string) {
  assert.equal(r.code, 0, `${what} exited ${r.code}: ${r.err}`)
  return r.json!
}

const fns = (steps: Step[]) => steps.map((s) => s.function.split("(")[0])

/** Runs `body` and puts the chain back as it was, so a claimer can be claimed for more than once. */
async function isolated(body: () => Promise<void>): Promise<void> {
  const id = await c.test.snapshot()
  try {
    await body()
  } finally {
    await c.test.revert({ id })
  }
}

// --- stake ----------------------------------------------------------------------

test("stake approves exactly the amount when the allowance is short, then stakes it", { skip, timeout: TIMEOUT }, async () => {
  const [before, safeBefore] = [await stakeOf(c, user.address, validator), await safeBalance(c, user.address)]
  assert.equal(await allowance(c, user.address), 0n)
  const r = ok(await safenet(["stake", validator, "40"]), "stake")
  assert.deepEqual(fns(r.steps), ["approve", "stake"])
  assert.ok(r.steps.every((s) => s.transaction?.status === "success"))
  assert.equal(await stakeOf(c, user.address, validator) - before, parseEther("40"))
  assert.equal(safeBefore - await safeBalance(c, user.address), parseEther("40"))
  assert.equal(await allowance(c, user.address), 0n, "an exact approval is used up by the stake")
})

test("stake --approve unlimited approves 2^256 - 1, and the next stake sends no approval", { skip, timeout: TIMEOUT }, async () => {
  const before = await stakeOf(c, user.address, validator)
  const first = ok(await safenet(["stake", validator, "10", "--approve", "unlimited"]), "stake --approve unlimited")
  assert.deepEqual(fns(first.steps), ["approve", "stake"])
  assert.equal(first.steps[0]!.args.amount, String(maxUint256))
  // The chain, not the output: the allowance is 2^256 - 1, or that less the 10 SAFE staked if the
  // token spends from an unlimited allowance too.
  const unlimited = await allowance(c, user.address)
  assert.ok(unlimited === maxUint256 || unlimited === maxUint256 - parseEther("10"), `allowance ${unlimited}`)
  const second = ok(await safenet(["stake", validator, "5"]), "stake with the allowance in place")
  assert.deepEqual(fns(second.steps), ["stake"])
  assert.equal(await stakeOf(c, user.address, validator) - before, parseEther("15"))
  assert.ok(await allowance(c, user.address) <= unlimited, "no second approval raised the allowance")
})

// --- unstake and the withdrawal claims --------------------------------------------

let firstId: bigint
let secondId: bigint

test("unstake opens a pending withdrawal for the amount and lowers the stake", { skip, timeout: TIMEOUT }, async () => {
  const before = await stakeOf(c, user.address, validator)
  const r = ok(await safenet(["unstake", validator, "20"]), "unstake")
  assert.equal(before - await stakeOf(c, user.address, validator), parseEther("20"))
  const queue = await pending(c, user.address)
  assert.equal(queue.length, 1)
  assert.equal(queue[0]!.amount, parseEther("20"))
  const withdrawal = r.withdrawal as { id: string; claimableAt: { value: string } }
  firstId = BigInt(withdrawal.id)
  assert.equal(new Date(withdrawal.claimableAt.value).getTime(), Number(queue[0]!.claimableAt) * 1000)
})

test("withdrawals claim refuses inside the delay, where the contract reverts with NoClaimableWithdrawal", { skip, timeout: TIMEOUT }, async () => {
  const state = async () => ({
    nonce: await c.chain.getTransactionCount({ address: user.address }),
    safe: await safeBalance(c, user.address),
    pending: (await pending(c, user.address)).map((w) => `${w.amount}@${w.claimableAt}`),
    block: await c.chain.getBlockNumber(),
  })
  const before = await state()
  const r = await safenet(["withdrawals", "claim", "--all"])
  assert.equal(r.code, 1)
  assert.match(r.err, /^error: None of .*'s 1 pending withdrawal is claimable yet; the oldest, id \d+, is claimable at .* UTC\.\n$/)
  // The revert the CLI's refusal stands in for, decoded from core's ABI: core's proof of it.
  await assert.rejects(
    c.chain.simulateContract({ account: user.address, address: STAKING, abi: stakingAbi, functionName: "claimWithdrawal" }),
    (err: Error) => /NoClaimableWithdrawal/.test(err.message),
  )
  assert.deepEqual(await state(), before, "the refusal changed the chain")
})

test("after the delay, claim --all pays what is past it and names what is not", { skip, timeout: TIMEOUT }, async () => {
  await warp(c, (await withdrawDelay(c)) + 1n)
  const opened = ok(await safenet(["unstake", validator, "5"]), "a second unstake")
  secondId = BigInt((opened.withdrawal as { id: string }).id)
  const safeBefore = await safeBalance(c, user.address)

  const r = ok(await safenet(["withdrawals", "claim", "--all"]), "withdrawals claim --all")
  assert.deepEqual(r.claimed, [{ id: String(firstId), amount: { wei: String(parseEther("20")), safe: "20" } }])
  assert.deepEqual((r.notYetClaimable as { id: string }[]).map((w) => w.id), [String(secondId)])
  assert.equal(await safeBalance(c, user.address) - safeBefore, parseEther("20"))
  assert.deepEqual((await pending(c, user.address)).map((w) => w.amount), [parseEther("5")])
})

test("withdrawals claim <id> waits for that id's delay, then pays it", { skip, timeout: TIMEOUT }, async () => {
  const early = await safenet(["withdrawals", "claim", String(secondId)])
  assert.equal(early.code, 1)
  assert.match(early.err, new RegExp(`^error: Withdrawal ${secondId} is not claimable yet: it is in its delay until `))
  await warp(c, (await withdrawDelay(c)) + 1n)
  const safeBefore = await safeBalance(c, user.address)
  const r = ok(await safenet(["withdrawals", "claim", String(secondId)]), "withdrawals claim <id>")
  assert.deepEqual((r.claimed as { id: string }[]).map((w) => w.id), [String(secondId)])
  assert.equal(await safeBalance(c, user.address) - safeBefore, parseEther("5"))
  assert.equal((await pending(c, user.address)).length, 0)
})

// --- rewards, as a real address with a published proof ---------------------------

test("rewards claim pays the claimable amount and raises cumulativeClaimed by it", { skip, timeout: TIMEOUT }, async () => {
  await isolated(async () => {
    await impersonate(c, claimer.account)
    const [claimedBefore, safeBefore] = [await claimed(c, claimer.account), await safeBalance(c, claimer.account)]
    const r = ok(await safenet(["rewards", "claim"], impersonatedSigner(c, claimer.account)), "rewards claim")
    const claim = r.claim as { claimable: { value: { wei: string } }; received: { value: { wei: string } } }
    assert.equal(claim.claimable.value.wei, String(claimer.claimable))
    assert.equal(claim.received.value.wei, String(claimer.claimable))
    assert.equal(await claimed(c, claimer.account) - claimedBefore, claimer.claimable)
    assert.equal(await safeBalance(c, claimer.account) - safeBefore, claimer.claimable)
  })
})

test("claim-and-stake stakes what arrived", { skip, timeout: TIMEOUT }, async () => {
  await isolated(async () => {
    await impersonate(c, claimer.account)
    const [claimedBefore, stakeBefore, safeBefore] = [
      await claimed(c, claimer.account), await stakeOf(c, claimer.account, validator), await safeBalance(c, claimer.account),
    ]
    const r = await safenet(["rewards", "claim-and-stake", validator], impersonatedSigner(c, claimer.account))
    const data = ok(r, "rewards claim-and-stake")
    assert.deepEqual(fns(data.steps).slice(-1), ["stake"])
    assert.equal(fns(data.steps)[0], "claim")
    assert.equal((data.staked as { wei: string }).wei, String(claimer.claimable))
    assert.equal(await claimed(c, claimer.account) - claimedBefore, claimer.claimable)
    assert.equal(await stakeOf(c, claimer.account, validator) - stakeBefore, claimer.claimable)
    assert.equal(await safeBalance(c, claimer.account), safeBefore)
    // The claim's receipt and what arrived are reported before the stake is sent.
    const lines = r.err.trim().split("\n")
    const received = lines.findIndex((l) => l.startsWith(`received `) && l.includes(`(${claimer.claimable} wei)`))
    assert.ok(received > lines.findIndex((l) => l.startsWith("confirmed MerkleDrop.claim")), r.err)
    assert.ok(received < lines.findIndex((l) => l.startsWith("sent Staking.stake")), r.err)
  })
})

test("claim-and-stake --amount stakes that much when it is lower, and the rest stays in the wallet", { skip, timeout: TIMEOUT }, async () => {
  await isolated(async () => {
    await impersonate(c, claimer.account)
    const part = claimer.claimable / 3n
    // More than the claim can pay is refused before anything is sent.
    const claimedBefore = await claimed(c, claimer.account)
    const over = await safenet(
      ["rewards", "claim-and-stake", validator, "--amount", formatUnits(claimer.claimable + 1n, 18)],
      impersonatedSigner(c, claimer.account),
    )
    assert.equal(over.code, 1)
    assert.match(over.err, /^error: The amount to stake, .* SAFE, is more than the .* SAFE .* can claim, so nothing was claimed or staked\.\n$/)
    assert.equal(await claimed(c, claimer.account), claimedBefore)
    const [stakeBefore, safeBefore] = [await stakeOf(c, claimer.account, validator), await safeBalance(c, claimer.account)]
    const r = ok(
      await safenet(["rewards", "claim-and-stake", validator, "--amount", formatUnits(part, 18)], impersonatedSigner(c, claimer.account)),
      "rewards claim-and-stake --amount",
    )
    assert.equal((r.staked as { wei: string }).wei, String(part))
    assert.equal(r.cappedToReceived, false)
    assert.equal(await stakeOf(c, claimer.account, validator) - stakeBefore, part)
    assert.equal(await safeBalance(c, claimer.account) - safeBefore, claimer.claimable - part)
  })
})

// --- dry runs change nothing -----------------------------------------------------

/** Everything a write could change, for both accounts the suite writes as. */
async function fingerprint() {
  const of = async (a: Address) => ({
    nonce: await c.chain.getTransactionCount({ address: a }),
    safe: await safeBalance(c, a),
    allowance: await allowance(c, a),
    stake: await stakeOf(c, a, validator),
    pending: (await pending(c, a)).map((w) => `${w.amount}@${w.claimableAt}`),
    claimed: await claimed(c, a),
  })
  return { block: await c.chain.getBlockNumber(), user: await of(user.address), claimer: await of(claimer.account) }
}

/** A signer whose every signing method throws, and records that it was reached. */
function tripwire(address: Address, reached: string[]) {
  const trip = (what: string): never => {
    reached.push(what)
    throw new Error(`the signer was reached: ${what}`)
  }
  const account = toAccount({
    address,
    signMessage: async () => trip("signMessage"),
    signTransaction: async () => trip("signTransaction"),
    signTypedData: async () => trip("signTypedData"),
  })
  return (client: Parameters<typeof localSigner>[0]) => localSigner(client, account)
}

test("every command with --dry-run changes nothing on chain and never reaches a signer", { skip, timeout: TIMEOUT }, async () => {
  // A state where every command has something to do: a withdrawal past its delay to claim,
  // stake to unstake, and the claimer's reward still unclaimed, because each rewards test above
  // reverted its snapshot.
  ok(await safenet(["unstake", validator, "3"]), "an unstake to leave a withdrawal to claim")
  await warp(c, (await withdrawDelay(c)) + 1n)

  const before = await fingerprint()
  // The claimer's stake approves first unless its allowance already covers what arrives.
  const claimerApproves = before.claimer.allowance < claimer.claimable
  const claimAndStake = claimerApproves ? ["claim", "approve", "stake"] : ["claim", "stake"]
  const reached: string[] = []
  const asUser = tripwire(user.address, reached)
  const asClaimer = tripwire(claimer.account, reached)
  const runs: [string[], ReturnType<typeof tripwire>, string[]][] = [
    [["stake", validator, "1"], asUser, ["stake"]],
    [["unstake", validator, "1"], asUser, ["initiateWithdrawal"]],
    [["withdrawals", "claim", "--all"], asUser, ["claimWithdrawal"]],
    [["rewards", "claim"], asClaimer, ["claim"]],
    [["rewards", "claim-and-stake", validator], asClaimer, claimAndStake],
    [["rewards", "claim-and-stake", validator, "--amount", "0.001", "--approve", "unlimited"], asClaimer, claimAndStake],
  ]
  for (const [argv, signer, expected] of runs) {
    const r = ok(await safenet([...argv, "--dry-run"], signer), `${argv.join(" ")} --dry-run`)
    assert.deepEqual(fns(r.steps), expected, argv.join(" "))
    assert.ok(r.steps.every((s) => s.transaction === null), argv.join(" "))
  }
  assert.ok(claimerApproves, "no dry run here simulated a stake after its approval; pick a claimer without allowance")
  assert.deepEqual(reached, [], "a dry run reached a signer")
  assert.deepEqual(await fingerprint(), before, "a dry run changed the chain")
})
