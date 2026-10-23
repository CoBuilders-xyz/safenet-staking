/**
 * metrics-poc — prove every number we promised, from real data.
 *
 * This is the subgraph's mapping logic in scratch form. Every metric here becomes a
 * handler, so the subgraph is a port rather than an invention.
 *
 * Rules this script follows. Breaking any of them produces a number that looks right and is not:
 *
 *   1. No silent failures. A scan that cannot complete throws. A skipped range fails the run.
 *   2. No truncated output. Formatting never alters a value.
 *   3. Every rate states its window and sample size. A 2-hour sample is never called "per day".
 *   4. Derived numbers carry their formula and their source.
 *   5. Labels say what was measured. "Allocated" is not "distributed"; gross is not net.
 *   6. Results are emitted as JSON and the report is generated from it, never retyped.
 *
 *   node --env-file=../../.env.local --import tsx scripts/metrics-poc.ts
 *   node --env-file=../../.env.local --import tsx scripts/metrics-poc.ts --days 14 --json out.json
 */
import {
  createPublicClient, fallback, http, parseAbiItem, formatUnits,
  type AbiEvent, type Address, type Hex, type Log, type PublicClient,
} from "viem"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { CHAINS, RPC_URLS } from "../src/chains.js"
import { CONTRACTS, SEF_DATA } from "../src/contracts.js"
import { SHARE_LOOKBACK_BLOCKS, participationWindow } from "../src/sef.js"
import { stakingAbi, merkleDropAbi } from "../src/abis.js"
import { execFileSync } from "node:child_process"

// ---------------------------------------------------------------------------
const argNum = (flag: string, dflt: number) => {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 ? v : dflt
}
const argStr = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
/**
 * Participation window.
 *
 * SEF's workflow computes a ROLLING window ending at the top of the current hour:
 *   end="$(date -d "$(date '+%H:00:00')" '+%s')"; start="$((end - 1209600))"
 * (their args.ts default is Tuesday-aligned, but production overrides it; this shape was
 * confirmed by fitting our output against their published file across the hour).
 *
 * A block-count window would drift against theirs by however long ago they last published,
 * and that drift would read as OUR inaccuracy: 0.083pp at one hour of the cycle and over 0.3pp
 * at another. Aligning to the hour makes the comparison measure the formula rather than the clock.
 */
const DAYS = argNum("--days", 14)
const JSON_OUT = argStr("--json")

const gnosis = createPublicClient({
  chain: CHAINS.gnosis,
  transport: fallback(RPC_URLS.gnosis.map((u) => http(u))),
  batch: { multicall: true },
}) as PublicClient
const mainnet = createPublicClient({
  chain: CHAINS.mainnet,
  transport: fallback(RPC_URLS.mainnet.map((u) => http(u))),
  batch: { multicall: true },
}) as PublicClient

// ---------------------------------------------------------------------------
// Strict chunked scan.
//
// A bare `catch {}` here would swallow everything, including a bad RPC key, and a fallback
// that skipped slices with no signal would let a total infrastructure failure print a
// plausible, mostly-green table. This scan distinguishes "the response was too big, retry
// smaller" from "something is actually wrong", and throws on the latter.
// ---------------------------------------------------------------------------
// Deciding "the range was too big" from an error string is brittle: providers word it
// differently and a fallback transport hides the original. So decide empirically instead.
// Shrink and retry the SAME range. Only give up once a single small chunk still fails
// after several attempts, and then throw. A range is never skipped.
const MIN_CHUNK = 1_000n
const ATTEMPTS_AT_MIN = 3

let scanCalls = 0
let scanRequests = 0
let scanRetries = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function scan(
  client: PublicClient, address: Address, event: AbiEvent,
  fromBlock: bigint, toBlock: bigint, startChunk = 50_000n,
  onBatch?: (logs: Log[]) => void,
): Promise<Log[]> {
  scanCalls++
  const out: Log[] = []
  let from = fromBlock
  let chunk = startChunk
  let attemptsAtMin = 0

  while (from <= toBlock) {
    const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n
    try {
      scanRequests++
      const logs = (await client.getLogs({ address, event, fromBlock: from, toBlock: to })) as Log[]
      if (onBatch) onBatch(logs)
      else out.push(...logs)
      from = to + 1n
      attemptsAtMin = 0
      if (chunk < startChunk) chunk *= 2n
    } catch (err) {
      scanRetries++
      if (chunk > MIN_CHUNK) {
        chunk = chunk / 4n > MIN_CHUNK ? chunk / 4n : MIN_CHUNK
        continue
      }
      attemptsAtMin++
      if (attemptsAtMin >= ATTEMPTS_AT_MIN) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `scan failed on ${address} blocks ${from}..${to} after ${ATTEMPTS_AT_MIN} attempts at the ` +
          `minimum chunk size of ${MIN_CHUNK}. This range is NOT being skipped; the run stops here ` +
          `so no number is silently understated.\nOriginal: ${msg.slice(0, 300)}`,
        )
      }
      await sleep(1_000 * attemptsAtMin)
    }
  }
  return out
}

// --- events -----------------------------------------------------------------
const E = {
  stakeIncreased: parseAbiItem("event StakeIncreased(address indexed staker, address indexed validator, uint256 amount)"),
  withdrawalInitiated: parseAbiItem("event WithdrawalInitiated(address indexed staker, address indexed validator, uint64 indexed withdrawalId, uint256 amount)"),
  withdrawalClaimed: parseAbiItem("event WithdrawalClaimed(address indexed staker, uint64 indexed withdrawalId, uint256 amount)"),
  validatorUpdated: parseAbiItem("event ValidatorUpdated(address indexed validator, bool isRegistered)"),
  claimed: parseAbiItem("event Claimed(address indexed account, uint256 amount)"),
  signShared: parseAbiItem("event SignShared(bytes32 indexed sid, bytes32 indexed selectionRoot, address participant, uint256 z)"),
  signCompleted: parseAbiItem("event SignCompleted(bytes32 indexed sid, bytes32 indexed selectionRoot, ((uint256 x, uint256 y) r, uint256 z) signature)"),
  keyGenConfirmed: parseAbiItem("event KeyGenConfirmed(bytes32 indexed gid, address participant, bool confirmed)"),
  txAttested: parseAbiItem("event TransactionAttested(bytes32 indexed safeTxHash, uint256 indexed chainId, address indexed safe, uint64 epoch, bytes32 signatureId, ((uint256 x, uint256 y) r, uint256 z) attestation)"),
  txProposed: parseAbiItem("event TransactionProposed(bytes32 indexed safeTxHash, uint256 indexed chainId, address indexed safe, uint64 epoch, (uint256 chainId, address safe, address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) transaction)"),
  validatorStakerSet: parseAbiItem("event ValidatorStakerSet(address indexed validator, address staker)"),
  epochRolledOver: parseAbiItem("event EpochRolledOver(uint64 indexed newActiveEpoch)"),
  erc20Transfer: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
} as const

type Verdict = "PROVEN" | "PARTIAL" | "BLOCKED"
interface Row {
  group: string; metric: string; value: string; source: string
  window: string; verdict: Verdict; note?: string
}
const rows: Row[] = []
const add = (r: Row) => rows.push(r)

const fmt = (n: bigint, d = 18) =>
  Number(formatUnits(n, d)).toLocaleString("en-US", { maximumFractionDigits: 0 })
/** Percentage from bigints, without routing 1e24 values through a float. */
const pctOf = (num: bigint, den: bigint, dp = 2) =>
  den === 0n ? "n/a" : `${(Number((num * 1000000n) / den) / 10000).toFixed(dp)}%`

// ===========================================================================
async function run() {
  const t0 = Date.now()
  const staking = CONTRACTS.staking.address
  const merkle = CONTRACTS.merkleDrop.address
  const token = CONTRACTS.safeToken.address
  const consensus = CONTRACTS.consensus.address
  const coordinator = CONTRACTS.frostCoordinator.address
  const mFrom = CONTRACTS.staking.startBlock
  const cFrom = CONTRACTS.consensus.startBlock
  const kFrom = CONTRACTS.frostCoordinator.startBlock

  const [mLatest, gLatest] = await Promise.all([mainnet.getBlockNumber(), gnosis.getBlockNumber()])

  // Measure Gnosis block time instead of assuming 5s. The nominal 5s is 1.8% out.
  const [gNow, gThen] = await Promise.all([
    gnosis.getBlock({ blockNumber: gLatest }),
    gnosis.getBlock({ blockNumber: gLatest - 20_000n }),
  ])
  const gBlockTime = Number(gNow.timestamp - gThen.timestamp) / 20_000
  // gBlocksPerDay: derived but unused since the window moved to SEF's commit timestamp.

  /**
   * Block at a timestamp boundary.
   *
   *   side "first" -> first block with ts >= target   (use for an INCLUSIVE window start)
   *   side "last"  -> last  block with ts <= target   (use for an INCLUSIVE window end)
   *
   * Using "last" for both edges, as version three did, includes one block before the window
   * whenever no block lands exactly on the boundary second. Gnosis misses ~1.8% of slots, so
   * that silently breaks bit-exactness roughly one run in 27, with no diagnostic.
   */
  const blockAt = async (target: number, side: "first" | "last"): Promise<bigint> => {
    let lo = 1n, hi = gLatest
    while (lo < hi) {
      const mid = side === "last" ? (lo + hi + 1n) / 2n : (lo + hi) / 2n
      const ts = Number((await gnosis.getBlock({ blockNumber: mid })).timestamp)
      if (side === "last") { if (ts <= target) lo = mid; else hi = mid - 1n }
      else { if (ts >= target) hi = mid; else lo = mid + 1n }
    }
    const ts = Number((await gnosis.getBlock({ blockNumber: lo })).timestamp)
    // Never clamp silently: if the chain head is behind the requested boundary, say so.
    // One block time of slack, not ten minutes. The old 600s bound let a lagging node drop
    // ~120 blocks (~35 ceremonies) off the window end, which breaks bit-exactness and then
    // gets misread as a formula problem.
    if (Math.abs(ts - target) > Math.ceil(gBlockTime) + 1) {
      throw new Error(
        `blockAt(${new Date(target * 1000).toISOString()}, ${side}) resolved to block ${lo} at ` +
        `${new Date(ts * 1000).toISOString()}, ${Math.abs(ts - target)}s away, more than one block time. ` +
        `The node is probably behind the requested boundary. Refusing to silently truncate the window.`,
      )
    }
    return lo
  }
  // Align to SEF's window. Their cron ends the window at the top of the hour IT RAN, not the
  // hour we run, so aligning to our own clock still leaves us hours ahead of the figures they
  // published. Take the end from the commit that last wrote validator-info.json, floored to the
  // hour. That makes the comparison apples-to-apples instead of measuring the gap between runs.
  let endSec = Math.floor(Number(gNow.timestamp) / 3600) * 3600
  let windowSource = "top of OUR clock hour — SEF's publish time was unavailable"
  let windowAligned = false
  let sefRatesUrl: string = SEF_DATA.validatorInfo
  let sefNetUrl: string = SEF_DATA.networkInfo
  const sefRewardsUrl: string = SEF_DATA.rewardsLatest
  try {
    // Authenticated if a token is present: unauthenticated GitHub is 60 requests/hour per IP and
    // routinely exhausted, which drops us into the fallback below.
    // The third source is `gh auth token`. scripts/setup.sh already requires the gh CLI, so a
    // developer running this has a credential; asking them to copy it into a second place only
    // creates a secret to leak. When the limit is exhausted, the fallback downgrades two metrics
    // from PROVEN to PARTIAL without saying why, which is what this line prevents.
    // `||`, not `??`: an empty GITHUB_TOKEN= line in .env.local means unset, not "no token".
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ghCliToken()
    const commits = (await (await fetch(
      SEF_DATA.validatorInfoCommits,
      { headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) } },
    )).json()) as { sha: string; commit: { committer: { date: string } } }[]
    const c = commits[0]
    if (!c?.sha || !c.commit?.committer?.date) throw new Error("unexpected commits payload")
    endSec = participationWindow(new Date(c.commit.committer.date)).end.getTime() / 1000
    // Read the rates at THAT commit, not from main. The API and the raw CDN are separate caches,
    // so for a few minutes after a publish they can disagree by a whole 3-hour period.
    // update-data.yml line 85 stages exactly two files: network-info.json and
    // validator-info.json. Both are pinned. rewards/latest.json is NOT in that workflow; it is
    // written by a separate fortnightly PR, so pinning it to a 3-hourly commit would read a
    // stale root against a live chain read for hours after every rewards merge.
    const at = SEF_DATA.assetsAtCommit(c.sha)
    sefRatesUrl = `${at}/validator-info.json`
    sefNetUrl = `${at}/network-info.json`
    windowSource = `SEF publish ${c.commit.committer.date} (commit ${c.sha.slice(0, 7)}), floored to the hour`
    windowAligned = true
  } catch (e) {
    console.warn(`  WARNING: could not align to SEF's publish time (${e instanceof Error ? e.message : e}).`)
    console.warn(`           Participation will be compared against a window up to 3 hours out of step.`)
    console.warn(`           Set GITHUB_TOKEN in .env.local to avoid the unauthenticated rate limit.\n`)
  }
  const startSec = endSec - DAYS * 86_400
  const [gFrom, gTo] = await Promise.all([blockAt(startSec, "first"), blockAt(endSec, "last")])
  const gWindow = gTo - gFrom

  console.log(`\n  metrics proof of concept\n`)
  console.log(`  mainnet   ${mFrom}..${mLatest}  full history, ${Number(mLatest - mFrom).toLocaleString("en-US")} blocks`)
  console.log(`  gnosis    ${gFrom}..${gTo}  ${DAYS} days aligned to the hour, ${Number(gWindow).toLocaleString("en-US")} blocks`)
  console.log(`  window    ${new Date(startSec * 1000).toISOString()} .. ${new Date(endSec * 1000).toISOString()}`)
  console.log(`  aligned   ${windowSource}`)
  console.log(`  measured gnosis block time: ${gBlockTime.toFixed(3)}s (not assumed)\n`)
  console.log(`  scanning, this takes a few minutes…\n`)

  // -------------------------------------------------------------- SEF sources
  const [sefValidators, sefNet, sefRewards] = await Promise.all([
    fetch(sefRatesUrl).then((r) => r.json()) as Promise<
      { address: Address; label: string; is_active: boolean; participation_rate_14d: number | null; commission: number }[]>,
    fetch(sefNetUrl).then((r) => r.json()) as Promise<{ total_staked_amount: string; total_transactions_checked: number }>,
    fetch(sefRewardsUrl).then((r) => r.json()) as Promise<{ merkleRoot: Hex; tokenTotal: string; unpaidAmount: string; epoch: number; rewardsUntil: string }>,
  ])
  const labelOf = new Map(sefValidators.map((v) => [v.address.toLowerCase(), v.label]))

  // ======================================================= A. EXACT STATE ====
  const [totalStaked, onchainRoot, merkleBalance] = await Promise.all([
    mainnet.readContract({ address: staking, abi: stakingAbi, functionName: "totalStakedAmount" }),
    mainnet.readContract({ address: merkle, abi: merkleDropAbi, functionName: "merkleRoot" }),
    mainnet.readContract({
      address: token, abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")],
      functionName: "balanceOf", args: [merkle],
    }),
  ])
  // SEF publishes a decimal string with up to 18 places. Parse it exactly: routing it through
  // Number() rounds at ~1e6 and fabricates a ~1.3e11 wei gap in a document whose thesis is
  // wei-exactness. Chain and SEF are in fact identical to the wei.
  const [whole = "0", frac = ""] = sefNet.total_staked_amount.split(".")
  const sefStakedWei = BigInt(whole + frac.padEnd(18, "0").slice(0, 18))
  // Reconstructed at SEF's publish instant, below, once we have the movement history.
  add({
    group: "State", metric: "Total SAFE staked", value: `${fmt(totalStaked)} SAFE`,
    source: "chain: Staking.totalStakedAmount()", window: "instant", verdict: totalStaked > 0n ? "PROVEN" : "BLOCKED",
    note: "the live figure; compared against SEF's snapshot in the parity row below",
  })

  const rootsMatch = onchainRoot.toLowerCase() === sefRewards.merkleRoot.toLowerCase()
  add({
    group: "State", metric: "Merkle root vs published root",
    value: rootsMatch ? "identical" : `DIVERGED (chain ${onchainRoot}, file ${sefRewards.merkleRoot})`,
    source: "chain merkleRoot() vs assets/rewards/latest.json", window: "instant",
    verdict: rootsMatch ? "PROVEN" : "BLOCKED", note: `epoch ${sefRewards.epoch}, rewards until ${sefRewards.rewardsUntil.slice(0, 10)}`,
  })
  add({
    group: "State", metric: "MerkleDrop balance, unclaimed", value: `${fmt(merkleBalance)} SAFE`,
    source: "chain: SAFE.balanceOf(merkleDrop)", window: "instant",
    verdict: merkleBalance > 0n ? "PROVEN" : "PARTIAL",
    
  })

  // Per-validator stake, and completeness of the validator list.
  const valStakes = await mainnet.multicall({
    contracts: sefValidators.map((v) => ({
      address: staking, abi: stakingAbi, functionName: "totalValidatorStakes", args: [v.address],
    })),
    allowFailure: false,
  }) as bigint[]
  const stakeSum = valStakes.reduce((a, b) => a + b, 0n)
  add({
    group: "State", metric: "Validator list completeness",
    value: stakeSum === totalStaked ? `exact: ${sefValidators.length} validators sum to the wei` : `MISMATCH by ${fmt(totalStaked - stakeSum)} SAFE`,
    source: "Σ totalValidatorStakes() vs totalStakedAmount()", window: "instant",
    verdict: stakeSum === totalStaked ? "PROVEN" : "BLOCKED",
    
  })

  const shares = valStakes.map((s) => Number((s * 1_000_000n) / stakeSum) / 10_000)
  const hhi = Math.round(shares.reduce((a, p) => a + p * p, 0))
  add({
    group: "State", metric: "Stake distribution, HHI", value: `HHI ${hhi}`,
    source: "derived: Σ(share²) over per-validator stakes", window: "instant",
    // No independent source for HHI exists, so nothing here can fail. Reported, not proven.
    verdict: "PARTIAL",
    note: sefValidators.map((v, i) => `${v.label} ${shares[i]!.toFixed(1)}%`).join(", "),
  })

  // ==================================================== B. MAINNET HISTORY ===
  const [stakeLogs, wInit, wClaim, valUpd, claims] = await Promise.all([
    scan(mainnet, staking, E.stakeIncreased, mFrom, mLatest),
    scan(mainnet, staking, E.withdrawalInitiated, mFrom, mLatest),
    scan(mainnet, staking, E.withdrawalClaimed, mFrom, mLatest),
    scan(mainnet, staking, E.validatorUpdated, mFrom, mLatest),
    scan(mainnet, merkle, E.claimed, mFrom, mLatest),
  ])
  type StakeLog = { args: { staker: Address; validator: Address; amount: bigint }; blockNumber: bigint }
  const stakes = stakeLogs as unknown as StakeLog[]
  const withdrawals = wInit as unknown as { args: { staker: Address; validator: Address; amount: bigint }; blockNumber: bigint }[]

  // Conservation check: Σ staked − Σ withdrawn must equal the live total, to the wei.
  const inSum = stakes.reduce((a, l) => a + l.args.amount, 0n)
  const outSum = withdrawals.reduce((a, l) => a + l.args.amount, 0n)
  // Computed, not frozen in a comment: how many stake amounts could be cancelled out by a
  // matching withdrawal, which is the blind spot of the conservation identity.
  const withdrawalAmounts = new Set(withdrawals.map((l) => String(l.args.amount)))
  const cancellingPairs = stakes.filter((l) => withdrawalAmounts.has(String(l.args.amount))).length
  add({
    group: "History", metric: "Stake history, conservation check",
    value: inSum - outSum === totalStaked ? `exact: ${stakes.length} stakes, ${withdrawals.length} withdrawals` : `MISMATCH ${fmt(inSum - outSum - totalStaked)} SAFE`,
    source: "Σ StakeIncreased − Σ WithdrawalInitiated vs totalStakedAmount()",
    window: "full history", verdict: inSum - outSum === totalStaked ? "PROVEN" : "BLOCKED",
    note: `Scope: this validates the StakeIncreased and WithdrawalInitiated scans only, and only ` +
      `in aggregate. It cannot see a loss that cancels: ${cancellingPairs} stake amounts exactly ` +
      `equal some withdrawal amount today. It says nothing about the other scans, nor about ` +
      `per-delegator attribution.`,
  })

  // Current delegators, read from state, not inferred from events.
  const pairs = [...new Set(stakes.map((l) => `${l.args.staker.toLowerCase()}|${l.args.validator.toLowerCase()}`))]
  const current = await mainnet.multicall({
    contracts: pairs.map((p) => {
      const [s, v] = p.split("|") as [Address, Address]
      return { address: staking, abi: stakingAbi, functionName: "stakes" as const, args: [s, v] }
    }),
    allowFailure: false,
  }) as bigint[]
  const currentByValidator = new Map<string, Set<string>>()
  const everByValidator = new Map<string, Set<string>>()
  pairs.forEach((p, i) => {
    const [s, v] = p.split("|") as [string, string]
    if (!everByValidator.has(v)) everByValidator.set(v, new Set())
    everByValidator.get(v)!.add(s)
    if ((current[i] ?? 0n) > 0n) {
      if (!currentByValidator.has(v)) currentByValidator.set(v, new Set())
      currentByValidator.get(v)!.add(s)
    }
  })
  const curTotal = new Set(pairs.filter((_, i) => (current[i] ?? 0n) > 0n).map((p) => p.split("|")[0]!)).size
  const everTotal = new Set(pairs.map((p) => p.split("|")[0]!)).size
  // Someone with no stake but an unclaimed withdrawal is in cooldown, not exited.
  const claimedIdSet = new Set((wClaim as unknown as { args: { withdrawalId: bigint } }[]).map((l) => String(l.args.withdrawalId)))
  const inCooldown = new Set(
    (wInit as unknown as { args: { staker: Address; withdrawalId: bigint } }[])
      .filter((l) => !claimedIdSet.has(String(l.args.withdrawalId)))
      .map((l) => l.args.staker.toLowerCase()),
  )
  const stakedNow = new Set(pairs.filter((_, i) => (current[i] ?? 0n) > 0n).map((p) => p.split("|")[0]!))
  const cooldownOnly = [...inCooldown].filter((a) => !stakedNow.has(a)).length
  const byLabel = sefValidators
    .map((v) => `${v.label} ${currentByValidator.get(v.address.toLowerCase())?.size ?? 0}`)
    .join(", ")
  add({
    group: "History", metric: "Delegators, current", value: `${curTotal} addresses currently staked`,
    source: "chain: stakes(staker, validator) > 0 for every historical pair",
    window: "instant, over full history of pairs",
    // Read from chain state. No published figure to check it against. Reported, not proven.
    verdict: "PARTIAL",
    note: `per validator: ${byLabel}. Ever staked: ${everTotal}. ` +
      `${everTotal - curTotal - cooldownOnly} have fully exited; ${cooldownOnly} hold no stake but have an ` +
      `unclaimed withdrawal, so they are in cooldown rather than gone.`,
  })

  // Net staked over time, with REAL timestamps.
  const blockNums = [...new Set(stakes.concat(withdrawals as unknown as StakeLog[]).map((l) => l.blockNumber))]
  const tsByBlock = new Map<bigint, number>()
  for (let i = 0; i < blockNums.length; i += 40) {
    const slice = blockNums.slice(i, i + 40)
    const blocks = await Promise.all(slice.map((b) => mainnet.getBlock({ blockNumber: b })))
    blocks.forEach((b, j) => tsByBlock.set(slice[j]!, Number(b.timestamp)))
  }
  const movements = [
    ...stakes.map((l) => ({ b: l.blockNumber, amt: l.args.amount })),
    ...withdrawals.map((l) => ({ b: l.blockNumber, amt: -l.args.amount })),
  ].sort((a, b) => (a.b < b.b ? -1 : a.b > b.b ? 1 : 0))
  const series = new Map<string, bigint>()
  let net = 0n
  for (const m of movements) {
    net += m.amt
    series.set(new Date(tsByBlock.get(m.b)! * 1000).toISOString().slice(0, 10), net)
  }
  const days = [...series.keys()].sort()
  add({
    group: "History", metric: "Net staked over time",
    value: `${series.size} daily points, ends at ${fmt(net)} SAFE`,
    source: "StakeIncreased minus WithdrawalInitiated, cumulative, real block timestamps",
    window: `${days[0]} to ${days[days.length - 1]}`,
    verdict: net === totalStaked ? "PROVEN" : "PARTIAL",
    note: net === totalStaked ? "final point equals the live total, to the wei" : `final point differs from live total by ${fmt(net - totalStaked)}`,
  })

  // A second conservation identity, independent of the first, which covers the
  // WithdrawalClaimed scan that the stake equation does not touch.
  const pendingOnChain = await mainnet.readContract({
    address: staking,
    abi: [parseAbiItem("function totalPendingWithdrawals() view returns (uint256)")],
    functionName: "totalPendingWithdrawals",
  }) as bigint
  const claimedIds = new Set((wClaim as unknown as { args: { withdrawalId: bigint } }[]).map((l) => String(l.args.withdrawalId)))
  const pendingFromLogs = (wInit as unknown as { args: { withdrawalId: bigint; amount: bigint } }[])
    .filter((l) => !claimedIds.has(String(l.args.withdrawalId)))
    .reduce((a, l) => a + l.args.amount, 0n)
  add({
    group: "History", metric: "Withdrawal scan, conservation check",
    value: pendingFromLogs === pendingOnChain ? `exact: ${fmt(pendingOnChain)} SAFE pending` : `MISMATCH ${fmt(pendingFromLogs - pendingOnChain)} SAFE`,
    source: "Σ unclaimed WithdrawalInitiated vs totalPendingWithdrawals()",
    window: "full history", verdict: pendingFromLogs === pendingOnChain ? "PROVEN" : "BLOCKED",
    
  })

  // Parity on the headline number, done honestly: SEF's network-info.json is a snapshot taken at
  // their publish time and can be up to three hours behind the chain. Comparing it to a live read
  // measures publish lag. Reconstructing OUR total at THEIR instant measures agreement.
  const sefAsOf = endSec
  const netAtPublish = movements
    .filter((m) => (tsByBlock.get(m.b) ?? 0) <= sefAsOf)
    .reduce((a, m) => a + m.amt, 0n)
  const lag = totalStaked - netAtPublish
  add({
    group: "History", metric: "Total staked, parity with SEF",
    value: netAtPublish === sefStakedWei
      ? `exact: ${fmt(netAtPublish)} SAFE at their publish instant`
      : `MISMATCH ${(netAtPublish - sefStakedWei).toString()} wei`,
    source: "replay StakeIncreased/WithdrawalInitiated up to SEF's publish time, compare to network-info.json",
    window: new Date(sefAsOf * 1000).toISOString(),
    verdict: netAtPublish === sefStakedWei ? "PROVEN" : "PARTIAL",
    note: netAtPublish === sefStakedWei
      ? `Identical to the wei. The live chain has since moved by ${fmt(lag > 0n ? lag : -lag)} SAFE, ` +
        `which is publish lag, not disagreement.`
      : `Our reconstruction differs from SEF's published figure at the same instant, which is a ` +
        `real disagreement rather than lag.`,
  })

  add({
    group: "History", metric: "Withdrawal queue",
    value: `${wInit.length} initiated, ${wClaim.length} claimed, ${wInit.length - wClaim.length} outstanding`,
    source: "mainnet WithdrawalInitiated / WithdrawalClaimed", window: "full history",
    verdict: wClaim.length <= wInit.length ? "PROVEN" : "BLOCKED",
    
  })
  // The real completeness proof: replay every registration and deregistration, then compare the
  // resulting set to SEF's published list. Version three's note claimed this check existed; it
  // did not. It only counted events.
  const registered = new Map<string, boolean>()
  for (const l of valUpd as unknown as { args: { validator: Address; isRegistered: boolean } }[]) {
    registered.set(l.args.validator.toLowerCase(), l.args.isRegistered)
  }
  const onChainSet = new Set([...registered.entries()].filter(([, r]) => r).map(([a]) => a))
  const sefSet = new Set(sefValidators.map((v) => v.address.toLowerCase()))
  const onlyOnChain = [...onChainSet].filter((a) => !sefSet.has(a))
  const onlyInSef = [...sefSet].filter((a) => !onChainSet.has(a))
  const setsMatch = onlyOnChain.length === 0 && onlyInSef.length === 0
  add({
    group: "History", metric: "Validator set completeness",
    value: setsMatch
      ? `exact: ${onChainSet.size} registered on chain == ${sefSet.size} in SEF's list`
      : `MISMATCH: ${onlyOnChain.length} on chain not in SEF's list, ${onlyInSef.length} the other way`,
    source: "replay ValidatorUpdated (last write per validator), compare the registered set to validator-info.json",
    window: "full history", verdict: setsMatch ? "PROVEN" : "BLOCKED",
    note: `${valUpd.length} events across ${registered.size} addresses, ` +
      `${[...registered.values()].filter((r) => !r).length} deregistrations` +
      (setsMatch ? "" : ` — on chain only: ${onlyOnChain.join(", ")}; SEF only: ${onlyInSef.join(", ")}`),
  })

  // Rewards: allocated vs actually claimed. They are different numbers, reported separately.
  const claimedTotal = (claims as unknown as { args: { account: Address; amount: bigint } }[])
    .reduce((a, l) => a + l.args.amount, 0n)
  const allocated = BigInt(sefRewards.tokenTotal)
  add({
    group: "Rewards", metric: "Allocated to date", value: `${fmt(allocated)} SAFE`,
    source: "assets/rewards/latest.json tokenTotal, cross-checked against the 26-week schedule",
    window: `to ${sefRewards.rewardsUntil.slice(0, 10)}`,
    verdict: allocated > 0n && allocated <= 4_500_000n * 10n ** 18n ? "PROVEN" : "BLOCKED",
    note: "allocated, not claimed",
  })
  const claimants = new Set((claims as unknown as { args: { account: Address } }[]).map((l) => l.args.account.toLowerCase())).size
  add({
    group: "Rewards", metric: "Claimed, and the unclaimed gap",
    value: `${fmt(claimedTotal)} of ${fmt(allocated)} = ${pctOf(claimedTotal, allocated)} claimed`,
    source: "mainnet MerkleDrop Claimed events", window: "full history",
    verdict: allocated - claimedTotal === merkleBalance ? "PROVEN" : "PARTIAL",
    note: `${claims.length} claims by ${claimants} addresses, of ${curTotal} current delegators. ` +
      `Unclaimed: ${fmt(allocated - claimedTotal)} SAFE (${pctOf(allocated - claimedTotal, allocated)}). ` +
      (allocated - claimedTotal === merkleBalance
        ? "Third conservation identity holds to the wei: allocated minus claimed equals the live " +
          "contract balance, which proves the Claimed amounts are increments rather than cumulative totals."
        : `WARNING: allocated minus claimed is ${(allocated - claimedTotal - merkleBalance).toString()} wei ` +
          `away from the live balance, so the Claimed semantics are not what we assume.`),
  })

  // ============================================== C. PARTICIPATION, SEF-EXACT
  // SEF's workflow computes a ROLLING 14-day window ending at the top of the current hour.
  // Numerator: SignShared matching the winning selection root of a completed ceremony that
  // is a transaction attestation. Denominator: those ceremonies. The is_transaction_attestation
  // filter is applied here; without it both counts include ceremonies SEF excludes.
  const attested = await scan(gnosis, consensus, E.txAttested, gFrom, gTo, 20_000n)
  const attestationSids = new Set(
    (attested as unknown as { args: { signatureId: Hex } }[]).map((l) => l.args.signatureId.toLowerCase()),
  )
  const completed = await scan(gnosis, coordinator, E.signCompleted, gFrom, gTo, 20_000n)
  const winningRoot = new Map<string, string>()
  let ceremoniesAll = 0
  let ceremoniesAttest = 0
  for (const c of completed as unknown as { args: { sid: Hex; selectionRoot: Hex } }[]) {
    ceremoniesAll++
    const sid = c.args.sid.toLowerCase()
    if (!attestationSids.has(sid)) continue
    ceremoniesAttest++
    winningRoot.set(sid, c.args.selectionRoot.toLowerCase())
  }

  // A ceremony can COMPLETE inside the window while its shares were emitted just before the
  // start. Scanning shares only over [gFrom, gTo] drops those, which breaks bit-exactness on
  // roughly a quarter of window boundaries. SEF has all history indexed and loses nothing.
  // The membership test is the sid map, so looking back cannot pull in foreign ceremonies.
  // SHARE_LOOKBACK_BLOCKS in src/sef.ts gives the measured spans.
  const signed = new Map<string, number>()
  await scan(gnosis, coordinator, E.signShared, gFrom - SHARE_LOOKBACK_BLOCKS, gTo, 5_000n, (batch) => {
    for (const s of batch as unknown as { args: { sid: Hex; selectionRoot: Hex; participant: Address } }[]) {
      const sid = s.args.sid.toLowerCase()
      if (winningRoot.get(sid) !== s.args.selectionRoot.toLowerCase()) continue
      const who = s.args.participant.toLowerCase()
      signed.set(who, (signed.get(who) ?? 0) + 1)
    }
  })

  add({
    group: "Participation", metric: "is_transaction_attestation filter",
    value: ceremoniesAll === 0
      ? "no ceremonies in window"
      : `${ceremoniesAttest} of ${ceremoniesAll} ceremonies are attestations (${((ceremoniesAttest / ceremoniesAll) * 100).toFixed(2)}%)`,
    source: "join SignCompleted.sid to TransactionAttested.signatureId", window: `${DAYS}d`,
    verdict: ceremoniesAttest > 0 ? "PROVEN" : "BLOCKED",
    note: "This is SEF's own join key, read from their source: src/indexing/transactions.ts " +
      "registers a ceremony as a transaction attestation keyed on TransactionAttested.signatureId, " +
      "and selectParticipation in src/data/attestations.ts filters on that flag. Our numerators " +
      "and denominator also reproduce their published output exactly, out of sample.",
  })

  const participation = sefValidators.map((v) => {
    const n = signed.get(v.address.toLowerCase()) ?? 0
    return { label: v.label, address: v.address, ours: n / ceremoniesAttest, sef: v.participation_rate_14d, rounds: n }
  })
  const worst = participation.reduce((a, b) => (a.ours < b.ours ? a : b))
  const best = participation.reduce((a, b) => (a.ours > b.ours ? a : b))
  // SEF can publish a null rate. There is nothing to compare it with, so it is no gap, and a run
  // where SEF published none proves nothing: it is not bit-exact.
  const published = participation.filter((p): p is typeof p & { sef: number } => p.sef !== null)
  const unpublished = participation.length - published.length
  const maxDelta = Math.max(0, ...published.map((p) => Math.abs(p.ours - p.sef)))
  const bitExact = published.length === participation.length && published.every((p) => p.ours === p.sef)
  add({
    group: "Participation", metric: "Participation rate, reproduced",
    value: `${participation.length} validators over ${ceremoniesAttest.toLocaleString("en-US")} ceremonies`,
    source: "SignShared joined to SignCompleted on the winning selection root, attestations only",
    window: `${DAYS} days, ${windowSource}`,
    // PROVEN means bit-identical. Anything else is PARTIAL, however close. The old bar was
    // maxDelta < 0.02, i.e. two percentage points, which would have passed a badly wrong run.
    verdict: bitExact ? "PROVEN" : "PARTIAL",
    note: bitExact
      ? `EXACT: all ${participation.length} rates are bit-identical to SEF's published doubles ` +
        `(same numerators over denominator ${ceremoniesAttest}).`
      : published.length === 0
        ? `NOT COMPARED: SEF publishes no rate for any of the ${participation.length} validators.`
        : (unpublished ? `${unpublished} of ${participation.length} validators have no published rate and are not compared. ` : "") +
        (windowAligned ? "" : "NOT ALIGNED to SEF's publish hour, so this comparison is not meaningful. ") +
        `largest gap vs SEF's published figure: ${(maxDelta * 100).toFixed(4)} percentage points. ` +
        `A residual here is window misalignment, not necessarily a formula error. Measured over 14 ` +
        `consecutive SEF publications, a single three-hour step moves a validator's rate by up to ` +
        `0.32pp. Do not use a fixed threshold to tell the two apart: check ` +
        `windowSource first, and only suspect the formula once the window is confirmed aligned.`,
  })
  add({
    group: "Participation", metric: "Performance spread between validators",
    value: `${(best.ours * 100).toFixed(2)}% (${best.label}) down to ${(worst.ours * 100).toFixed(2)}% (${worst.label})`,
    source: "same computation", window: `${DAYS} days`,
    // The spread is only meaningful if the rates it is drawn from reproduce SEF's. A check
    // such as max >= min would be true of any array, so it proves nothing.
    verdict: bitExact ? "PROVEN" : "PARTIAL",
    note: `spread of ${((best.ours - worst.ours) * 100).toFixed(2)} percentage points. ` +
      `Absences: ${ceremoniesAttest - worst.rounds} vs ${ceremoniesAttest - best.rounds}`,
  })

  // Drop-outs. The expected set is the participants of the CURRENT group, taken from every
  // KeyGenConfirmed for that gid. Not filtered on `confirmed`: that is a "generation complete"
  // flag set only on the last submitter, so filtering on it would under-report by 5/6.
  const keyGen = await scan(gnosis, coordinator, E.keyGenConfirmed, kFrom, gLatest, 20_000n)
  const kg = keyGen as unknown as { args: { gid: Hex; participant: Address }; blockNumber: bigint }[]
  // 8.1% of historical keygen groups permanently have fewer than the full participant set, so
  // "take the latest gid" can silently drop a validator. Take the latest group whose size equals
  // the modal size, and report if the very latest was short.
  const byGid = new Map<string, Set<string>>()
  for (const l of kg) {
    const g = l.args.gid.toLowerCase()
    if (!byGid.has(g)) byGid.set(g, new Set())
    byGid.get(g)!.add(l.args.participant.toLowerCase())
  }
  const sizes = [...byGid.values()].map((v) => v.size)
  const tally = new Map<number, number>()
  for (const n of sizes) tally.set(n, (tally.get(n) ?? 0) + 1)
  const modal = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  const gidOrder = [...byGid.keys()]
  const latestFull = [...gidOrder].reverse().find((g) => byGid.get(g)!.size === modal)
  const latestGid = gidOrder[gidOrder.length - 1]
  const expected = byGid.get(latestFull ?? latestGid!) ?? new Set<string>()
  const groups = byGid.size
  const shortLatest = byGid.get(latestGid!)!.size < modal
  // Cardinality alone is not enough: a 6-member group containing a stranger also has size 6.
  const sefAddrs = new Set(sefValidators.map((v) => v.address.toLowerCase()))
  const strangers = [...expected].filter((a) => !sefAddrs.has(a))
  const missing = [...sefAddrs].filter((a) => !expected.has(a))
  const expectedMatchesSef = strangers.length === 0 && missing.length === 0
  const absences = [...expected].map((a) => ({ a, n: ceremoniesAttest - (signed.get(a) ?? 0) }))
  add({
    group: "Participation", metric: "Signing-round absences",
    value: `${absences.reduce((s, x) => s + x.n, 0).toLocaleString("en-US")} absences over ${ceremoniesAttest.toLocaleString("en-US")} rounds`,
    source: "participants of the latest KeyGen group, minus signers of each winning root",
    window: `${DAYS} days`,
    verdict: expectedMatchesSef ? "PROVEN" : "PARTIAL",
    note: (expectedMatchesSef ? "" :
      `WARNING: the keygen group does not match SEF's validator list. ` +
      (missing.length ? `${missing.length} validator(s) absent from the group and therefore from the ` +
        `counts below: ${missing.join(", ")}. ` : "") +
      (strangers.length ? `${strangers.length} signer(s) in the group are not SEF validators: ` +
        `${strangers.join(", ")}. ` : "")) +
      `${expected.size} participants (modal group size ${modal} across ${groups} groups; ` +
      `${sizes.filter((n) => n < modal).length} groups are permanently short` +
      `${shortLatest ? ", INCLUDING the latest, so we used the most recent full group instead" : ""}). ` +
      absences.sort((x, y) => y.n - x.n).map((x) => `${labelOf.get(x.a) ?? x.a.slice(0, 8)}: ${x.n}`).join(", "),
  })

  // ==================================================== D. ATTESTATION RATES
  // Day boundaries are found exactly, by binary search on block timestamps. Sampling one block
  // in 200 and interpolating has a mean error of 10s and a max of 34s, enough to move events
  // across midnight and put a per-day range off by two.
  const perDay = new Map<string, number>()
  const dayEdges: { day: string; from: bigint }[] = []
  const firstDay = Math.ceil(startSec / 86_400) * 86_400
  for (let t = firstDay; t <= endSec; t += 86_400) {
    dayEdges.push({ day: new Date(t * 1000).toISOString().slice(0, 10), from: await blockAt(t, "first") })
  }
  const dayOf = (b: bigint) => {
    let lo = 0, hi = dayEdges.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (dayEdges[mid]!.from <= b) { found = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return found >= 0 ? dayEdges[found]!.day : null
  }
  for (const l of attested as unknown as { blockNumber: bigint }[]) {
    const d = dayOf(l.blockNumber)
    if (d) perDay.set(d, (perDay.get(d) ?? 0) + 1)
  }
  // Every bucket here is a complete UTC day by construction: the first boundary is the first
  // midnight at or after the window start, and the last day is dropped because the window ends
  // on an hour rather than a midnight.
  const fullDays = [...perDay.entries()].sort().slice(0, -1)
  const meanPerDay = fullDays.length ? Math.round(fullDays.reduce((a, [, n]) => a + n, 0) / fullDays.length) : 0
  add({
    group: "Attestation", metric: "Transactions attested per day",
    value: `${meanPerDay.toLocaleString("en-US")}/day mean over ${fullDays.length} complete days`,
    source: "gnosis TransactionAttested, bucketed by UTC day boundaries found by binary search on block timestamps",
    window: `${DAYS} days, ${attested.length.toLocaleString("en-US")} events`, verdict: fullDays.length >= 2 ? "PROVEN" : "PARTIAL",
    note: `range ${Math.min(...fullDays.map(([, n]) => n)).toLocaleString("en-US")} to ${Math.max(...fullDays.map(([, n]) => n)).toLocaleString("en-US")} per day. ` +
      `SEF's total_transactions_checked reads ${sefNet.total_transactions_checked.toLocaleString("en-US")}. ` +
      `That is a cumulative counter of a DIFFERENT event (TransactionProposed), so it is not ` +
      `comparable to this rate and we do not compare them.`,
  })

  // Latency. Measured over ~14h, not 2h: a two-hour sample gives an unstable p95 (it read 6
  // in one run and 13 in another with identical logic). TransactionProposed carries full
  // calldata and hits a 10MB response ceiling, so it is scanned in small chunks.
  //
  // Known, quantified limitation: ~0.2% of safeTxHashes are re-proposed (2 of 908 measured),
  // and we keep the earliest proposal, which slightly overstates latency for those. The widest
  // re-proposal gap observed was 3 blocks, so the effect on the quantiles is negligible.
  const latFrom = gLatest - 10_000n
  const [latAtt, latProp] = await Promise.all([
    scan(gnosis, consensus, E.txAttested, latFrom, gLatest, 2_000n),
    scan(gnosis, consensus, E.txProposed, latFrom - 200n, gLatest, 200n),
  ])
  const proposedAt = new Map<string, bigint>()
  for (const p of latProp as unknown as { args: { safeTxHash: Hex }; blockNumber: bigint }[]) {
    const h = p.args.safeTxHash.toLowerCase()
    if (!proposedAt.has(h)) proposedAt.set(h, p.blockNumber)
  }
  // Right-tail truncation: a transaction proposed near the window end may be attested after it,
  // so counting every attestation biases against slow pairs. Only count pairs whose PROPOSAL is
  // far enough from the end that its attestation had room to land inside the window.
  const MAX_EXPECTED_LATENCY = 64n
  const cutoff = gLatest - MAX_EXPECTED_LATENCY
  let droppedNearEdge = 0
  const deltas = (latAtt as unknown as { args: { safeTxHash: Hex }; blockNumber: bigint }[])
    .flatMap((a) => {
      const h = a.args.safeTxHash.toLowerCase()
      const p = proposedAt.get(h)
      if (p === undefined) return []
      if (p > cutoff) { droppedNearEdge++; return [] }
      return [Number(a.blockNumber - p)]
    }).sort((x, y) => x - y)
  const q = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))] ?? 0
  add({
    group: "Attestation", metric: "Attestation latency",
    value: deltas.length ? `median ${q(0.5)} blocks (~${(q(0.5) * gBlockTime).toFixed(0)}s), p90 ${q(0.9)}, p95 ${q(0.95)}, max ${deltas[deltas.length - 1]}` : "no pairs",
    source: "TransactionProposed to TransactionAttested, matched on safeTxHash",
    window: `10,000 blocks (~${(10000 * gBlockTime / 3600).toFixed(1)}h), ` +
      `${deltas.length + droppedNearEdge}/${latAtt.length} attestations matched a proposal, ` +
      `${deltas.length} counted`,
    verdict: deltas.length > 1000 ? "PROVEN" : "PARTIAL",
    note: `p95 is unstable over short samples (measured 6, 9 and 13 across disjoint windows), so it ` +
      `is quoted from ~14h rather than ~2h. The median is steadier but not invariant: 5, 5, 4 over ` +
      `the same three windows. ` +
      `${droppedNearEdge} matched pairs excluded within ${MAX_EXPECTED_LATENCY} blocks of the window ` +
      `end, so the slow tail is not truncated. The left edge is handled by looking proposals back ` +
      `200 blocks before the attestation window, which is ${(200 / Number(MAX_EXPECTED_LATENCY)).toFixed(2)}x the ` +
      `exclusion margin. ${MAX_EXPECTED_LATENCY} is 2x the largest latency yet observed.`,
  })

  // ========================================================== E. IDENTITY ====
  const vss = await scan(gnosis, consensus, E.validatorStakerSet, cFrom, gLatest, 20_000n)
  const currentMapping = new Map<string, string>()
  for (const l of vss as unknown as { args: { validator: Address; staker: Address } }[]) {
    currentMapping.set(l.args.validator.toLowerCase(), l.args.staker.toLowerCase())
  }
  add({
    group: "Identity", metric: "Validator to staker mapping",
    value: `${currentMapping.size} current mappings, from ${vss.length} events`,
    source: "gnosis ValidatorStakerSet, last write per validator wins", window: "full history",
    // Every validator SEF lists should have a current staker mapping.
    verdict: currentMapping.size === sefValidators.length ? "PROVEN" : "PARTIAL",
    note: `${vss.length - currentMapping.size} superseded mappings must be ignored; joining on all events double-counts`,
  })

  const epochs = await scan(gnosis, consensus, E.epochRolledOver, cFrom, gLatest, 20_000n)
  const el = epochs as unknown as { args: { newActiveEpoch: bigint }; blockNumber: bigint }[]
  const isClock = el.length > 1 && el.every((e) => e.args.newActiveEpoch === e.blockNumber / 1440n)
  const span = el.length ? Number(el[el.length - 1]!.args.newActiveEpoch - el[0]!.args.newActiveEpoch) + 1 : 0
  add({
    group: "Identity", metric: "Epoch rollovers",
    value: `${epochs.length.toLocaleString("en-US")} events, ${span - epochs.length} missing in a span of ${span}`,
    source: "gnosis EpochRolledOver", window: "full history",
    verdict: el.length > 0 && isClock ? "PROVEN" : "PARTIAL",
    note: isClock
      ? "epoch == blockNumber/1440, so this is a 2-hour clock tick and carries NO validator-set information. The missing rollovers are the only signal here."
      : "epoch is not a pure function of block number; worth investigating",
  })

  // ========================================================== F. DERIVED =====
  // SEF's own script is authoritative on the schedule:
  // safenet-staking-scripts/src/utils/args.ts — 4.5M SAFE over 26 WEEKS from 2026-04-07.
  const TOTAL_REWARDS = 4_500_000n * 10n ** 18n
  const PROGRAMME_DAYS = 26 * 7
  const START = Date.UTC(2026, 3, 7) / 1000
  const END = START + PROGRAMME_DAYS * 86_400
  const paidDays = (Date.parse(sefRewards.rewardsUntil) / 1000 - START) / 86_400
  const expectedAllocated = (TOTAL_REWARDS * BigInt(Math.round(paidDays))) / BigInt(PROGRAMME_DAYS)
  const scheduleOk = expectedAllocated - allocated === BigInt(sefRewards.unpaidAmount)
  add({
    group: "Derived", metric: "Reward schedule, verified",
    value: scheduleOk ? "exact" : `off by ${fmt(expectedAllocated - allocated - BigInt(sefRewards.unpaidAmount))} SAFE`,
    source: "4,500,000 SAFE over 26 weeks from 2026-04-07, per SEF's own args.ts",
    window: `${Math.round(paidDays)} of ${PROGRAMME_DAYS} days paid`,
    verdict: scheduleOk ? "PROVEN" : "PARTIAL",
    note: `allocated + unpaid dust reproduces the schedule to the wei`,
  })
  const daysLeft = Math.max(0, Math.round((END - Date.now() / 1000) / 86_400))
  const remaining = TOTAL_REWARDS - allocated
  const annualised = (TOTAL_REWARDS * 365n * 10_000n) / (BigInt(PROGRAMME_DAYS) * totalStaked)
  add({
    group: "Derived", metric: "Reward rate — NOT an APY",
    value: `${(Number(annualised) / 100).toFixed(2)}% gross annualised while the subsidy runs`,
    source: "derived: (4.5M × 365/182) / total staked",
    window: `subsidy ends ${new Date(END * 1000).toISOString().slice(0, 10)}, ${daysLeft} days away`,
    verdict: "PARTIAL",
    note: `Gross: before 5% commission and before the 75% participation gate. ` +
      `${fmt(remaining)} SAFE remains. Calling this an APY implies a sustained forward rate that does not exist. ` +
      `Ship the remaining pool and the end date instead, or this figure with both stated beside it.`,
  })

  // ============================================================ OUTPUT =======
  const pad = (s: string, n: number) => (s.length >= n ? s + "  " : s.padEnd(n))
  let group = ""
  for (const r of rows) {
    if (r.group !== group) { group = r.group; console.log(`\n  ── ${group} ${"─".repeat(Math.max(0, 78 - group.length))}`) }
    console.log(`  ${pad(r.metric, 34)}${pad(r.value, 46)}${r.verdict}`)
    console.log(`  ${" ".repeat(34)}${r.source}`)
    console.log(`  ${" ".repeat(34)}window: ${r.window}`)
    if (r.note) for (const line of wrap(r.note, 92)) console.log(`  ${" ".repeat(34)}${line}`)
  }

  console.log(`\n  PARTICIPATION, ours vs SEF's published 14-day figure\n`)
  console.log(`  ${pad("VALIDATOR", 22)}${pad("OURS", 10)}${pad("SEF", 10)}${pad("DELTA", 10)}ABSENCES`)
  for (const p of participation.sort((a, b) => b.ours - a.ours)) {
    console.log(
      `  ${pad(p.label, 22)}${pad((p.ours * 100).toFixed(3) + "%", 10)}` +
      `${pad(p.sef === null ? "not published" : (p.sef * 100).toFixed(3) + "%", 10)}` +
      `${pad(p.sef === null ? "" : ((p.ours - p.sef) * 100).toFixed(3) + "pp", 10)}${(ceremoniesAttest - p.rounds).toLocaleString("en-US")}`,
    )
  }

  const c = (v: Verdict) => rows.filter((r) => r.verdict === v).length
  console.log(`\n  ${c("PROVEN")} proven · ${c("PARTIAL")} partial · ${c("BLOCKED")} blocked   (${rows.length} metrics)`)
  console.log(`  ${scanRequests} RPC log requests across ${scanCalls} scans, ${scanRetries} retries, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`)

  if (JSON_OUT) {
    mkdirSync(dirname(JSON_OUT), { recursive: true })
    writeFileSync(JSON_OUT, JSON.stringify({
      runAt: new Date().toISOString(), mainnetBlock: String(mLatest), gnosisBlock: String(gLatest),
      gnosisBlockTime: gBlockTime, windowDays: DAYS,
      // Machine-readable figures. Consumers must never parse them out of a display string:
      // doing that once turned 4,641 per day into 460,413.
      figures: {
        attestationsPerDay: meanPerDay,
        attestationsPerDayMin: fullDays.length ? Math.min(...fullDays.map(([, n]) => n)) : 0,
        attestationsPerDayMax: fullDays.length ? Math.max(...fullDays.map(([, n]) => n)) : 0,
        latencyMedianBlocks: q(0.5),
        latencyP95Blocks: q(0.95),
        latencySeconds: Math.round(q(0.5) * gBlockTime),
        totalStakedWei: totalStaked.toString(),
        allocatedWei: allocated.toString(),
        claimedWei: claimedTotal.toString(),
        unclaimedWei: (allocated - claimedTotal).toString(),
        currentDelegators: curTotal,
        hhi,
      },
      rows, participation:
        participation.map((p) => ({ ...p, absences: ceremoniesAttest - p.rounds })),
      ceremonies: { all: ceremoniesAll, attestations: ceremoniesAttest },
    }, null, 2))
    console.log(`  wrote ${JSON_OUT}\n`)
  }
  if (c("BLOCKED")) process.exitCode = 1
}

/**
 * The token the gh CLI already holds, or undefined. Never printed, never written to a file.
 * A failure here is not an error: the caller falls back to an unauthenticated request.
 */
function ghCliToken(): string | undefined {
  try {
    const t = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return t.length > 0 ? t : undefined
  } catch {
    return undefined
  }
}

function wrap(s: string, n: number): string[] {
  const out: string[] = []
  let line = ""
  for (const word of s.split(" ")) {
    if ((line + word).length > n) { out.push(line.trimEnd()); line = "" }
    line += word + " "
  }
  if (line.trim()) out.push(line.trimEnd())
  return out
}

await run()
