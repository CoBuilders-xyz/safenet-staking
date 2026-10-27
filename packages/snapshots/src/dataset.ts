/**
 * The day's dataset: every figure read at the pinned points, then checked against itself.
 *
 * Figures the CLI's library already computes come from it, through a pinned context: stake,
 * share, registration, delegator counts, withdrawal totals and queues, rewards and the Merkle
 * root. The records, events and buckets come from the subgraphs, read at the same blocks. Where
 * the two describe the same quantity, they must agree to the wei, or the day is not published.
 *
 * Every figure names where it was read: a block of a chain, or one of SEF's files at a commit.
 * See `At`, and the schema in this package's README.
 */
import {
  VALIDATOR_SOURCES,
  type Context, type Figure, type NetworkStatus, type NetworkWithdrawals, type ParticipationWindow, type QueuedWithdrawal,
  type ValidatorDetail,
} from "@cobuilders/safenet-cli/lib"
import { CONTRACTS, GNOSIS_INDEXED_PROGRAMME, SEF_DATA_REPO, stakingAbi } from "@cobuilders/safenet-core"
import { getAddress, type Address } from "viem"
import { SnapshotError } from "./errors.js"
import type { SefPin } from "./pinned.js"
import { allRows, oneRow, selectFields, type BlockRef, type Query } from "./subgraph.js"

/** Bumped when a file's shape changes in a way a reader of an older snapshot would misread. */
export const SNAPSHOT_SCHEMA = "safenet-snapshot/1"

/** Where a figure was read. A figure from both carries both. */
export type At =
  | { readonly chain: "mainnet" | "gnosis"; readonly block: bigint }
  | { readonly sef: string; readonly commit: string }
  | { readonly sef: string; readonly dataset: string }

export interface Fig<T> {
  readonly value: T
  readonly source: string
  readonly at: readonly At[]
  /** Why the value is null, when it is. */
  readonly reason?: string
}

/** Subgraph rows, all read at one block of one deployment. */
export interface Rows<T> {
  readonly source: string
  readonly at: At
  readonly deployment: string
  /** Fields this repository's schema has and the deployment does not, so no row carries them. */
  readonly absentFields: readonly string[]
  readonly rows: readonly T[]
}

/** A point of one chain the snapshot was read at. */
export interface ChainPoint {
  readonly block: bigint
  readonly hash: string
  readonly timestamp: bigint
  /** The subgraph deployment, an IPFS hash, read at this block. */
  readonly deployment: string
  /** The subgraph's query URL. Public: packages/core never holds a key in it. */
  readonly endpoint: string
}

export interface Points {
  /** The UTC day of the Mainnet block, YYYY-MM-DD. The snapshot is indexed under it. */
  readonly day: string
  readonly mainnet: ChainPoint
  readonly gnosis: ChainPoint
  readonly sef: readonly SefPin[]
}

/** The CLI library's operations the snapshot reuses. Passed in, so the tests supply them. */
export interface CliReads {
  readonly getStatus: (ctx: Context) => Promise<NetworkStatus>
  readonly showValidator: (ctx: Context, address: Address) => Promise<ValidatorDetail>
  readonly fetchValidatorsWithWindow: (ctx: Context) => Promise<{ validators: { address: string }[]; window: ParticipationWindow }>
  readonly networkWithdrawals: (ctx: Context) => Promise<NetworkWithdrawals>
  readonly readQueue: (ctx: Context, staker: Address, block: { number: bigint; timestamp: bigint }) => Promise<QueuedWithdrawal[]>
}

export interface Sources {
  /** A context pinned to `points`: see pinned.ts. */
  readonly ctx: Context
  readonly cli: CliReads
  readonly mainnet: Query
  readonly gnosis: Query
  readonly points: Points
  /** The bytes of one of SEF's pinned files. */
  readonly sefFile: (path: string) => Promise<Uint8Array>
  /** The repository commit and the run that built the snapshot, when known. */
  readonly build: { readonly commit: string | null; readonly run: string | null }
}

export interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

/** The files of one day, by path inside the day's directory. JSON values are serialised later. */
export interface Dataset {
  readonly day: string
  readonly json: Readonly<Record<string, unknown>>
  /** SEF's files, byte for byte. */
  readonly raw: Readonly<Record<string, Uint8Array>>
}

// --- Subgraph fields, as the schemas in this repository name them ---
//
// Each read asks for the fields the deployment has, by introspection, and records the others in
// `absentFields`: see selectFields.

interface EntitySpec {
  /** The plural query field. */
  readonly entity: string
  readonly type: string
  readonly fields: readonly string[]
  readonly what: string
}

const words = (s: string) => s.split(" ")

const MAINNET_NETWORK = words("totalStaked pendingWithdrawals rewardsClaimed activeValidators stakersCurrent stakersEver " +
  "delegationsCurrent delegationsEver stakeCount withdrawalCount rewardPeriods currentRoot")

const MAINNET: Record<string, EntitySpec> = {
  validators: { entity: "validators", type: "Validator", what: "Validator", fields: words(
    "address isRegistered totalStaked stakersCurrent stakersEver registeredAtBlock registeredAtTimestamp " +
    "firstSeenAtBlock firstSeenAtTimestamp lastUpdatedAtBlock") },
  delegations: { entity: "delegations", type: "Delegation", what: "Delegation, one per staker and validator", fields: [
    "staker", "validator { id }", ...words("amount firstStakedAtBlock firstStakedAtTimestamp lastActivityAtBlock")] },
  stakers: { entity: "stakers", type: "Staker", what: "Staker, one per address", fields: words(
    "address totalStaked validatorCount firstStakedAtBlock firstStakedAtTimestamp lastActivityAtBlock") },
  stakes: { entity: "stakes", type: "Stake", what: "Stake, one per StakeIncreased event", fields: [
    "staker", "validator { id }", ...words("amount blockNumber timestamp transactionHash")] },
  withdrawals: { entity: "withdrawals", type: "Withdrawal", what: "Withdrawal, one per withdrawalId", fields: [
    "staker", "validator { id }", ...words("amount claimed initiatedAtBlock initiatedAtTimestamp claimedAtBlock " +
    "claimedAtTimestamp initiatedTxHash claimedTxHash")] },
  claims: { entity: "rewardClaims", type: "RewardClaim", what: "RewardClaim, one per Claimed event", fields: words(
    "account cumulativeAmount amount blockNumber timestamp transactionHash") },
  periods: { entity: "rewardPeriods", type: "RewardPeriod", what: "RewardPeriod, one per MerkelRootUpdated event", fields: words(
    "period previousRoot root blockNumber timestamp transactionHash cumulativeClaimedAtStart") },
  accounts: { entity: "rewardAccounts", type: "RewardAccount", what: "RewardAccount, one per claiming address", fields: words(
    "account cumulativeClaimed claimCount firstClaimAtTimestamp lastClaimAtTimestamp") },
  days: { entity: "dayDatas", type: "DayData", what: "DayData, one per UTC day with activity", fields: words(
    "date totalStaked stakedIn withdrawnOut rewardsClaimed stakeCount withdrawalCount") },
}

/** `programme` is asked for on every bucket; only the Aegis schema has it. */
const GNOSIS: Record<string, EntitySpec> = {
  consensuses: { entity: "consensuses", type: "Consensus", what: "Consensus, the running totals", fields: words(
    "programme attestationCeremonies nonAttestationCeremonies attestations proposals latencySamples epochRollovers " +
    "currentEpoch validatorCount openCeremonies") },
  signingValidators: { entity: "signingValidators", type: "SigningValidator", what: "SigningValidator", fields: words(
    "address staker attended firstSeenBlock lastSeenBlock") },
  consensusDays: { entity: "consensusDays", type: "ConsensusDay", what: "ConsensusDay", fields: words(
    "programme date attestations attestationCeremonies latencyBuckets latencyOverflow latencySamples") },
  validatorDays: { entity: "validatorDays", type: "ValidatorDay", what: "ValidatorDay", fields: [
    "programme", "validator { id }", "date", "attended"] },
  consensusHours: { entity: "consensusHours", type: "ConsensusHour", what: "ConsensusHour", fields: words(
    "programme hour attestationCeremonies attestationCeremoniesOnTheHour") },
  validatorHours: { entity: "validatorHours", type: "ValidatorHour", what: "ValidatorHour", fields: [
    "programme", "validator { id }", ...words("hour ceremonies attended missed ceremoniesOnTheHour attendedOnTheHour missedOnTheHour")] },
}

/** Every row of an entity at `block`, with the fields the deployment has. */
async function readRows(query: Query, chain: "Mainnet" | "Gnosis", spec: EntitySpec, block: BlockRef, at: At, deployment: string) {
  const { selection, absent } = await selectFields(query, spec.type, spec.fields)
  const rows = (await allRows<Row>(query, spec.entity, selection, block)).map(flatten)
  return { source: `subgraph: ${chain} ${spec.what}`, at, deployment, absentFields: absent, rows } satisfies Rows<Row>
}

type Row = { id: string } & Record<string, unknown>

/** `validator { id }` becomes the id, so a row reads as the subgraph's flat record. */
function flatten(row: Row): Row {
  const out: Row = { id: row.id }
  for (const [k, v] of Object.entries(row)) {
    if (k === "id") continue
    out[k] = v !== null && typeof v === "object" && !Array.isArray(v) && "id" in v ? (v as { id: unknown }).id : v
  }
  return out
}

const big = (value: unknown, what: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new SnapshotError(`${what} is not an integer: ${String(value)}`)
  return BigInt(value)
}

/** Read everything, check it, and return the day's files. Throws SnapshotError for a day that cannot be published. */
export async function collect(sources: Sources): Promise<Dataset> {
  const { ctx, cli, points } = sources
  const B = points.mainnet.block
  const G = points.gnosis.block
  const mainnetRef = { number: B, hash: points.mainnet.hash }
  const gnosisRef = { number: G, hash: points.gnosis.hash }
  const mainnetAt: At = { chain: "mainnet", block: B }
  const gnosisAt: At = { chain: "gnosis", block: G }
  const pin = (path: string): SefPin => {
    const p = points.sef.find((s) => s.path === path)
    if (!p) throw new SnapshotError(`no commit pinned for SEF's ${path}`)
    return p
  }
  const sefAt = (path: string): At => ({ sef: path, commit: pin(path).commit })

  // --- The CLI's figures, at B and at the pinned commits ---
  const status = await cli.getStatus(ctx)
  const atBlock = (what: string, block: bigint) => {
    if (block !== B) throw new SnapshotError(`${what} was read at block ${block}, not the pinned block ${B}`)
  }
  atBlock("the network status", status.block)

  // rewards/latest.json is read from SEF's IPFS dataset when its ENS name is set, else from
  // the repository at the pinned commit.
  const latestAt: At = status.rewardsSource.kind === "repository"
    ? sefAt("rewards/latest.json")
    : { sef: "rewards/latest.json", dataset: status.rewardsSource.url }

  /** Where a CLI figure was read, from its source string. A figure that names neither is refused. */
  const attribute = (source: string): At[] => {
    const at: At[] = []
    if (source.startsWith("chain:") || source.includes("chain: ")) at.push(mainnetAt)
    if (source.includes("validator-info.json")) at.push(sefAt("validator-info.json"))
    if (source.includes("network-info.json")) at.push(sefAt("network-info.json"))
    if (source.includes("rewards/latest.json")) at.push(latestAt)
    if (at.length === 0) throw new SnapshotError(`the figure "${source}" names neither a chain nor one of SEF's files`)
    return at
  }
  const fig = <T>(f: Figure<T> & { reason?: string }): Fig<T> =>
    f.reason === undefined
      ? { value: f.value, source: f.source, at: attribute(f.source) }
      : { value: f.value, source: f.source, at: attribute(f.source), reason: f.reason }

  // --- Subgraph rows at the same blocks ---
  const mainnetRows = (spec: EntitySpec) => readRows(sources.mainnet, "Mainnet", spec, mainnetRef, mainnetAt, points.mainnet.deployment)
  const networkFields = await selectFields(sources.mainnet, "Network", MAINNET_NETWORK)
  const network = await oneRow<Row>(sources.mainnet, "network", "1", `id ${networkFields.selection}`, mainnetRef)
  const [validatorRows, delegations, stakers, stakes, withdrawalRows, claims, periods, accounts, days] = await Promise.all([
    mainnetRows(MAINNET.validators!),
    mainnetRows(MAINNET.delegations!),
    mainnetRows(MAINNET.stakers!),
    mainnetRows(MAINNET.stakes!),
    mainnetRows(MAINNET.withdrawals!),
    mainnetRows(MAINNET.claims!),
    mainnetRows(MAINNET.periods!),
    mainnetRows(MAINNET.accounts!),
    mainnetRows(MAINNET.days!),
  ])

  // --- Validators: SEF's list and every validator the subgraph has seen ---
  const { validators: listed, window } = await cli.fetchValidatorsWithWindow(ctx)
  if (window.unknownBecause) throw new SnapshotError(`the participation window is unknown: ${window.unknownBecause}`)
  const listedIds = new Set(listed.map((v) => v.address.toLowerCase()))
  const addresses = [...new Set([...listedIds, ...validatorRows.rows.map((v) => v.id.toLowerCase())])] as Address[]

  const checks: Check[] = []
  const expect = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  const mine = (id: string) => (r: Row) => r.validator === id
  const records = (id: string, row: Row | null) => ({
    registration: {
      source: validatorRows.source, at: mainnetAt, deployment: validatorRows.deployment, absentFields: validatorRows.absentFields, row,
    },
    delegations: { ...delegations, rows: delegations.rows.filter(mine(id)) },
    events: {
      stakes: { ...stakes, rows: stakes.rows.filter(mine(id)) },
      withdrawals: { ...withdrawalRows, rows: withdrawalRows.rows.filter(mine(id)) },
    },
  })

  const validators = await Promise.all(addresses.map(async (id) => {
    const row = validatorRows.rows.find((r) => r.id === id) ?? null
    // `validators show` describes an address SEF lists or the chain registers. A validator the
    // subgraph saw register and then leave is neither: its stake and registration are read
    // from the contract here, the two reads the CLI makes, and SEF's fields are null.
    if (!listedIds.has(id) && !(await ctx.client.readContract({
      address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "isValidator", args: [id], blockNumber: B,
    }))) {
      const stake = await ctx.client.readContract({
        address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalValidatorStakes", args: [id], blockNumber: B,
      })
      if (row) {
        expect(`Validator ${id}: subgraph totalStaked equals Staking.totalValidatorStakes()`,
          big(row.totalStaked, "Validator.totalStaked") === stake, `${String(row.totalStaked)} and ${stake}`)
      }
      const unlisted = "SEF's validator-info.json does not list it"
      const notCounted = "the CLI counts delegators of a validator SEF lists or the chain registers; " +
        "the subgraph's counts are in registration"
      return {
        address: getAddress(id),
        label: { value: null, source: VALIDATOR_SOURCES.label, at: [sefAt("validator-info.json")], reason: unlisted },
        active: { value: null, source: VALIDATOR_SOURCES.active, at: [sefAt("validator-info.json")], reason: unlisted },
        registered: { value: false, source: VALIDATOR_SOURCES.registered, at: [mainnetAt] },
        commission: { value: null, source: VALIDATOR_SOURCES.commission, at: [sefAt("validator-info.json")], reason: unlisted },
        stake: { value: stake, source: VALIDATOR_SOURCES.stake, at: [mainnetAt] },
        share: {
          value: null, source: VALIDATOR_SOURCES.share, at: [mainnetAt],
          reason: "not registered; the CLI computes a share for a validator it describes",
        },
        participation: { value: null, source: VALIDATOR_SOURCES.participation, at: [sefAt("validator-info.json")], reason: unlisted },
        delegators: { value: null, source: "chain: StakeIncreased logs for this validator", at: [mainnetAt], reason: notCounted },
        ...records(id, row),
      }
    }

    const d = await cli.showValidator(ctx, id)
    atBlock(`validator ${id}`, d.block)
    const v = d.validator
    if (d.delegators.value === null) {
      throw new SnapshotError(`the delegators of ${v.address} could not be counted: ${d.delegators.unavailableBecause ?? "no reason given"}`)
    }
    if (row) {
      expect(`Validator ${id}: subgraph totalStaked equals Staking.totalValidatorStakes()`,
        big(row.totalStaked, "Validator.totalStaked") === v.stake, `${String(row.totalStaked)} and ${v.stake}`)
      expect(`Validator ${id}: subgraph stakersCurrent and stakersEver equal the delegators the CLI counts`,
        row.stakersCurrent === d.delegators.value.current && row.stakersEver === d.delegators.value.ever,
        `${String(row.stakersCurrent)}/${String(row.stakersEver)} and ${d.delegators.value.current}/${d.delegators.value.ever}`)
    } else {
      expect(`Validator ${id}: the subgraph has a row`, v.stake === 0n,
        `SEF lists it; the subgraph has no row, which holds only while its stake is 0 (stake ${v.stake})`)
    }
    const s = d.sources
    return {
      address: v.address,
      label: fig({ value: v.label, source: s.label }),
      active: fig({ value: v.active, source: s.active }),
      registered: fig({ value: v.registered, source: s.registered }),
      commission: fig({ value: v.commission, source: s.commission }),
      stake: fig({ value: v.stake, source: s.stake }),
      share: fig({ value: v.share, source: s.share }),
      participation: fig({ value: v.participation, source: s.participation }),
      delegators: fig(d.delegators),
      ...records(id, row),
    }
  }))

  // --- Withdrawals: the CLI's totals, and each open queue read from the contract ---
  const withdrawals = await cli.networkWithdrawals(ctx)
  atBlock("the withdrawal totals", withdrawals.block)
  const open = [...new Set(withdrawalRows.rows.filter((w) => w.claimed === false).map((w) => String(w.staker).toLowerCase()))].sort()
  const blockRef = { number: B, timestamp: points.mainnet.timestamp }
  const queues = await Promise.all(open.map(async (staker) => ({
    staker,
    withdrawals: await cli.readQueue(ctx, staker as Address, blockRef),
  })))
  const queued = queues.reduce((sum, q) => sum + q.withdrawals.reduce((s, w) => s + w.amount.wei, 0n), 0n)
  expect("The withdrawal logs sum to Staking.totalPendingWithdrawals()", withdrawals.logsMatchChain,
    `${withdrawals.openSum} and ${withdrawals.total.value}`)
  expect("The queues of every staker with an open withdrawal sum to Staking.totalPendingWithdrawals()",
    queued === withdrawals.total.value, `${queued} and ${withdrawals.total.value}`)

  // --- Network: the subgraph's running state against the chain ---
  expect("Network.totalStaked equals Staking.totalStakedAmount()",
    big(network.totalStaked, "Network.totalStaked") === status.totalStaked.value, `${String(network.totalStaked)} and ${status.totalStaked.value}`)
  expect("Network.pendingWithdrawals equals Staking.totalPendingWithdrawals()",
    big(network.pendingWithdrawals, "Network.pendingWithdrawals") === status.pendingWithdrawals.value,
    `${String(network.pendingWithdrawals)} and ${status.pendingWithdrawals.value}`)
  expect("Network.currentRoot equals MerkleDrop.merkleRoot()",
    String(network.currentRoot).toLowerCase() === status.merkleRoot.onChain.value.toLowerCase(),
    `${String(network.currentRoot)} and ${status.merkleRoot.onChain.value}`)

  // --- Gnosis: the participation buckets, with the programme each belongs to ---
  const gnosis = await gnosisBuckets(sources.gnosis, gnosisRef, gnosisAt, points.gnosis.deployment)

  const failed = checks.filter((c) => !c.ok)
  if (failed.length) {
    throw new SnapshotError(`${failed.length} check${failed.length > 1 ? "s" : ""} failed at Mainnet block ${B}: ` +
      failed.map((c) => `${c.name} (${c.detail})`).join("; "))
  }

  const header = (file: string) => ({ schema: SNAPSHOT_SCHEMA, day: points.day, file })
  const raw: Record<string, Uint8Array> = {}
  for (const p of points.sef) raw[`sef/${p.path}`] = await sources.sefFile(p.path)

  const json: Record<string, unknown> = {
    "network.json": {
      ...header("network.json"),
      totalStaked: fig(status.totalStaked),
      totalStakedPublished: fig(status.totalStakedPublished),
      activeValidators: fig(status.activeValidators),
      registeredValidators: fig(status.registeredValidators),
      pendingWithdrawals: fig(status.pendingWithdrawals),
      network: {
        source: "subgraph: Mainnet Network, the running totals", at: mainnetAt, deployment: points.mainnet.deployment,
        absentFields: networkFields.absent, row: network,
      },
      days,
    },
    "validators.json": {
      ...header("validators.json"),
      participationWindow: { ...window, at: [sefAt("validator-info.json")] },
      validators,
      stakers,
    },
    "withdrawals.json": {
      ...header("withdrawals.json"),
      total: fig(withdrawals.total),
      count: fig(withdrawals.count),
      initiated: { value: withdrawals.initiated, source: withdrawals.count.source, at: [mainnetAt] },
      claimed: { value: withdrawals.claimed, source: withdrawals.count.source, at: [mainnetAt] },
      queues: {
        value: queues,
        source: "chain: Staking.withdrawalQueues(staker) and Staking.withdrawalNodes(staker, id), for every staker " +
          "with an unclaimed Withdrawal row in the Mainnet subgraph",
        at: [mainnetAt],
      },
      withdrawals: withdrawalRows,
    },
    "rewards.json": {
      ...header("rewards.json"),
      allocated: fig(status.rewardsAllocated),
      epoch: fig(status.rewardsEpoch),
      unclaimed: fig(status.rewardsUnclaimed),
      merkleDropBalance: fig(status.merkleDropBalance),
      merkleRoot: {
        onChain: fig(status.merkleRoot.onChain),
        published: fig(status.merkleRoot.published),
        match: status.merkleRoot.match,
      },
      rewardsSource: status.rewardsSource,
      periods,
      accounts,
      claims,
    },
    "participation.json": { ...header("participation.json"), ...gnosis },
  }

  json["manifest.json"] = {
    ...header("manifest.json"),
    mainnet: points.mainnet,
    gnosis: points.gnosis,
    sef: {
      repository: SEF_DATA_REPO,
      files: points.sef.map((p) => ({ path: p.path, commit: p.commit, publishedAt: p.publishedAt, copy: `sef/${p.path}` })),
    },
    rewardsLatest: latestAt,
    files: [...Object.keys(json), ...Object.keys(raw)].sort(),
    // Sorted, because the reads that add them run concurrently.
    checks: [...checks].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    build: sources.build,
  }
  return { day: points.day, json, raw }
}

/**
 * The Gnosis buckets. When the deployment's schema has a `programme` field on a type, every row
 * of it carries the field as the subgraph answers it. When it has none, the deployment indexes
 * one programme's contracts, and core's GNOSIS_INDEXED_PROGRAMME names it, for all the rows.
 */
async function gnosisBuckets(query: Query, block: BlockRef, at: At, deployment: string) {
  const out: Record<string, unknown> = {}
  const programme: Record<string, { value: string | null; source: string }> = {}
  for (const [key, spec] of Object.entries(GNOSIS)) {
    const rows = await readRows(query, "Gnosis", spec, block, at, deployment)
    if (spec.fields.includes("programme")) {
      programme[key] = rows.absentFields.includes("programme")
        ? {
            value: GNOSIS_INDEXED_PROGRAMME,
            source: `packages/core GNOSIS_INDEXED_PROGRAMME: this deployment's ${spec.type} has no programme field, ` +
              "and the deployment indexes that one programme's contracts",
          }
        : { value: null, source: `subgraph: Gnosis ${spec.type}.programme, on each row` }
    }
    out[key] = rows
  }
  return { programme, ...out }
}
