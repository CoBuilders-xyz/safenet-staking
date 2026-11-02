/**
 * Offline stand-ins for the subgraphs, SEF's files and the CLI library, so the builder runs end
 * to end in the unit tests without a network.
 *
 * The fixtures under src/fixtures are cut from a real snapshot of 2026-10-27, in the shapes the
 * subgraphs answered and SEF published: three Mainnet validators (one SEF lists and the chain
 * registers, one SEF lists and the chain does not, one only the subgraph has seen), their rows,
 * and a few Gnosis buckets. Every address and hash in them is replaced by a made-up value, so no
 * file in this package types a real one out. The Mainnet totals are the fixture validators' own
 * sums, so the checks between the CLI and the subgraph hold.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  Context, NetworkStatus, NetworkWithdrawals, ParticipationWindow, QueuedWithdrawal, SefValidator, ValidatorDetail,
} from "@cobuilders/safenet-cli/lib"
import { VALIDATOR_SOURCES } from "@cobuilders/safenet-cli/lib"
import { getAddress, type Address, type Hex, type PublicClient } from "viem"
import type { CliReads, Points, Sources } from "./dataset.js"
import type { Query } from "./subgraph.js"

const FIXTURES = join(import.meta.dirname, "fixtures")
const read = (path: string) => readFileSync(join(FIXTURES, path))
const json = <T>(path: string): T => JSON.parse(read(path).toString("utf8")) as T

type Row = { id: string } & Record<string, unknown>
export type SubgraphFixture = Record<string, Row[] | Row>

export const mainnetFixture = () => json<SubgraphFixture>("mainnet-subgraph.json")
export const gnosisFixture = () => json<SubgraphFixture>("gnosis-subgraph.json")
export const sefFixture = (path: string): Uint8Array => new Uint8Array(read(`sef/${path}`))
export const sefValidators = () => json<SefValidator[]>("sef/validator-info.json")
export const rewardsLatest = () => json<{ merkleRoot: string; tokenTotal: string; epoch: number; rewardsUntil: string }>(
  "sef/rewards/latest.json")

/** The entity type behind each query field, as the schemas name them. */
const TYPES: Record<string, string> = {
  network: "Network", validators: "Validator", delegations: "Delegation", stakers: "Staker", stakes: "Stake",
  withdrawals: "Withdrawal", rewardClaims: "RewardClaim", rewardPeriods: "RewardPeriod", rewardAccounts: "RewardAccount",
  dayDatas: "DayData", consensuses: "Consensus", signingValidators: "SigningValidator", consensusDays: "ConsensusDay",
  validatorDays: "ValidatorDay", consensusHours: "ConsensusHour", validatorHours: "ValidatorHour",
}

export interface FakeSubgraphOptions {
  /** Fields the deployment lacks, by type. */
  readonly absent?: Readonly<Record<string, readonly string[]>>
  /** Adds `programme` to every row of these types, as the Aegis schema does. */
  readonly programme?: readonly string[]
  /** The block hash the deployment holds. Any other hash is an error, as on graph-node. */
  readonly hash?: string
  /** Every query is recorded here. */
  readonly log?: string[]
}

/**
 * A subgraph over a fixture. It honours the selection, the `id_gt` paging, the 1000-row page,
 * introspection, and the block hash, which is all the builder asks of graph-node.
 */
export function fakeSubgraph(fixture: SubgraphFixture, options: FakeSubgraphOptions = {}): Query {
  const withProgramme = (type: string, row: Row): Row =>
    options.programme?.includes(type) ? { ...row, programme: "aegis" } : row
  const fieldsOf = (type: string): string[] => {
    const key = Object.keys(TYPES).find((k) => TYPES[k] === type)
    const value = key === undefined ? undefined : fixture[key]
    const sample = Array.isArray(value) ? value[0] : value
    if (!sample) return []
    return Object.keys(withProgramme(type, sample)).filter((f) => !options.absent?.[type]?.includes(f))
  }
  const select = (type: string, row: Row, selection: string): Row => {
    const names = selection.replace(/\{[^}]*\}/g, "").split(/\s+/).filter(Boolean)
    const have = new Set(fieldsOf(type))
    const missing = names.filter((n) => !have.has(n))
    if (missing.length) throw new Error(`Type \`${type}\` has no field \`${missing[0]}\``)
    const full = withProgramme(type, row)
    return Object.fromEntries(names.map((n) => [n, full[n]])) as Row
  }
  return async (query: string) => {
    options.log?.push(query)
    const typeQuery = /__type\(name: "(\w+)"\)/.exec(query)
    if (typeQuery) {
      const fields = fieldsOf(typeQuery[1]!)
      return { __type: fields.length ? { fields: fields.map((name) => ({ name })) } : null }
    }
    const hash = /block: \{ hash: "(0x[0-9a-f]+)" \}/.exec(query)?.[1]
    if (options.hash && hash !== options.hash) throw new Error("Failed to decode `block.hash` value: `no block with that hash found`")
    const one = /^\{\s*(\w+)\(id: "([^"]*)", [^)]*\) \{ ([^}]*(?:\{[^}]*\}[^}]*)*) \} \}$/.exec(query.trim())
    if (one) {
      const [, entity, id, selection] = one
      const row = fixture[entity!]
      return { [entity!]: row && !Array.isArray(row) && row.id === id ? select(TYPES[entity!]!, row, selection!) : null }
    }
    const many = /(\w+)\(first: (\d+),[^]*?id_gt: "([^"]*)" \}\) \{\s*([^]*?)\s*\}\s*\}\s*$/.exec(query)
    if (!many) throw new Error(`the fake subgraph does not answer: ${query}`)
    const [, entity, first, after, selection] = many
    const rows = fixture[entity!]
    if (!Array.isArray(rows)) throw new Error(`Type \`Query\` has no field \`${entity}\``)
    const page = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((r) => r.id > after!).slice(0, Number(first))
    return { [entity!]: page.map((r) => select(TYPES[entity!]!, r, selection!)) }
  }
}

export const BLOCK = 26_287_194n
export const BLOCK_HASH = `0x${"ab".repeat(32)}`
export const GNOSIS_BLOCK = 48_976_868n
export const GNOSIS_HASH = `0x${"cd".repeat(32)}`
export const COMMIT = "78970fb6333a9d193a095bd1df10e70d2f33ffa8"
export const REWARDS_COMMIT = "276526f6c0b204fa7d5aa4f788c0b7983b08bc7f"

export const points = (): Points => ({
  day: "2026-10-27",
  mainnet: { block: BLOCK, hash: BLOCK_HASH, timestamp: 1_793_141_975n, deployment: "QmMainnet", endpoint: "https://subgraph.example/mainnet" },
  gnosis: { block: GNOSIS_BLOCK, hash: GNOSIS_HASH, timestamp: 1_793_142_125n, deployment: "QmGnosis", endpoint: "https://subgraph.example/gnosis" },
  sef: [
    { path: "validator-info.json", commit: COMMIT, publishedAt: new Date("2026-10-27T22:18:42Z") },
    { path: "network-info.json", commit: COMMIT, publishedAt: new Date("2026-10-27T22:18:42Z") },
    { path: "rewards/latest.json", commit: REWARDS_COMMIT, publishedAt: new Date("2026-10-21T10:26:37Z") },
  ],
})

const WINDOW: ParticipationWindow = {
  days: 14,
  start: new Date("2026-10-13T22:00:00Z"),
  end: new Date("2026-10-27T22:00:00Z"),
  publishedAt: new Date("2026-10-27T22:18:42Z"),
  commit: COMMIT,
}

export interface FakeCliOptions {
  /** Read at another block than the pin, as an operation that read the head would. */
  readonly block?: bigint
  readonly window?: ParticipationWindow
  /** The delegator scan of every validator fails, as on an endpoint that refuses old logs. */
  readonly delegatorsUnavailable?: boolean
  /** Added to the chain's staked total, so the subgraph and the chain disagree. */
  readonly totalStakedOffset?: bigint
  /** getStatus throws this, as when SEF's file lost a field. */
  readonly statusError?: Error
}

/**
 * The CLI's reads over the fixtures: the chain agrees with the subgraph, SEF's file lists the
 * first two validators, and the third is neither listed nor registered.
 */
export function fakeCli(options: FakeCliOptions = {}): { cli: CliReads; ctx: Context } {
  const mainnet = mainnetFixture()
  const network = mainnet.network as Row
  const validatorRows = mainnet.validators as Row[]
  const withdrawals = mainnet.withdrawals as (Row & { staker: string; amount: string; claimed: boolean })[]
  const sef = sefValidators()
  const latest = rewardsLatest()
  const block = options.block ?? BLOCK
  const listed = new Set(sef.map((v) => v.address.toLowerCase()))
  const rowOf = (a: string) => validatorRows.find((r) => r.id === a.toLowerCase())
  const total = BigInt(network.totalStaked as string) + (options.totalStakedOffset ?? 0n)
  const pending = BigInt(network.pendingWithdrawals as string)

  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args: [Address] }) => {
      if (functionName === "isValidator") return listed.has(args[0].toLowerCase()) && rowOf(args[0])?.isRegistered === true
      if (functionName === "totalValidatorStakes") return BigInt((rowOf(args[0])?.totalStaked as string | undefined) ?? "0")
      throw new Error(`the fake chain does not answer ${functionName}`)
    },
  } as unknown as PublicClient
  const ctx: Context = { client, fetch: globalThis.fetch }

  const repository = {
    kind: "repository" as const, url: "https://raw.example/assets/rewards", gateway: null, tried: [],
    ens: { name: "rewards.example.eth", status: "empty" as const, contenthash: null, reason: null },
  }
  const getStatus = async (): Promise<NetworkStatus> => {
    if (options.statusError) throw options.statusError
    return {
      block,
      totalStaked: { value: total, source: "chain: Staking.totalStakedAmount()" },
      totalStakedPublished: { value: total, source: "SEF: network-info.json total_staked_amount, a snapshot published every 3 hours" },
      activeValidators: { value: sef.filter((v) => v.is_active).length, source: "SEF: validator-info.json is_active" },
      registeredValidators: {
        value: { registered: 1, listed: sef.length },
        source: "chain: Staking.isValidator() for each address in SEF's validator-info.json",
      },
      pendingWithdrawals: { value: pending, source: "chain: Staking.totalPendingWithdrawals()" },
      rewardsAllocated: { value: BigInt(latest.tokenTotal), source: "SEF: rewards/latest.json tokenTotal" },
      rewardsEpoch: { value: { epoch: latest.epoch, rewardsUntil: latest.rewardsUntil }, source: "SEF: rewards/latest.json epoch, rewardsUntil" },
      rewardsUnclaimed: { value: 1n, source: "chain: SAFE.balanceOf(MerkleDrop), while its root is the published one" },
      merkleDropBalance: { value: 1n, source: "chain: SAFE.balanceOf(MerkleDrop)" },
      merkleRoot: {
        onChain: { value: network.currentRoot as Hex, source: "chain: MerkleDrop.merkleRoot()" },
        published: { value: latest.merkleRoot, source: "SEF: rewards/latest.json merkleRoot" },
        match: true,
      },
      rewardsSource: repository,
    }
  }

  const showValidator = async (_ctx: Context, address: Address): Promise<ValidatorDetail> => {
    const s = sef.find((v) => v.address.toLowerCase() === address.toLowerCase())
    const row = rowOf(address)
    const stake = BigInt((row?.totalStaked as string | undefined) ?? "0")
    const delegatorSource = "chain: StakeIncreased logs for this validator from block 1, then Staking.stakes(staker, validator) > 0"
    return {
      block,
      window: options.window ?? WINDOW,
      validator: {
        address: getAddress(address),
        label: s?.label ?? null,
        active: s?.is_active ?? null,
        registered: row?.isRegistered === true && s !== undefined,
        commission: s?.commission ?? null,
        stake,
        share: Number((stake * 1_000_000_000n) / total) / 1_000_000_000,
        participation: s?.participation_rate_14d ?? null,
      },
      delegators: options.delegatorsUnavailable
        ? { value: null, source: delegatorSource, unavailableBecause: "Could not read StakeIncreased logs for blocks 1 to 1000" }
        : { value: { current: row?.stakersCurrent as number, ever: row?.stakersEver as number }, source: delegatorSource },
      sources: VALIDATOR_SOURCES,
    }
  }

  const networkWithdrawals = async (): Promise<NetworkWithdrawals> => ({
    scope: "network",
    block,
    total: { value: pending, source: "chain: Staking.totalPendingWithdrawals()" },
    count: { value: withdrawals.filter((w) => !w.claimed).length, source: "chain: WithdrawalInitiated logs without a WithdrawalClaimed" },
    initiated: withdrawals.length,
    claimed: withdrawals.filter((w) => w.claimed).length,
    openSum: pending,
    logsMatchChain: true,
  })

  const readQueue = async (_ctx: Context, staker: Address): Promise<QueuedWithdrawal[]> =>
    withdrawals
      .filter((w) => !w.claimed && w.staker.toLowerCase() === staker.toLowerCase())
      .map((w) => ({
        id: BigInt(w.id),
        amount: { wei: BigInt(w.amount), safe: "0" },
        claimableAt: new Date("2026-10-30T00:00:00Z"),
        claimable: false,
      }))

  return {
    ctx,
    cli: {
      getStatus,
      showValidator,
      fetchValidatorsWithWindow: async () => ({ validators: sef, window: options.window ?? WINDOW }),
      networkWithdrawals,
      readQueue,
    },
  }
}

/** Every source the builder reads, over the fixtures. */
export function fakeSources(options: FakeCliOptions & {
  mainnet?: FakeSubgraphOptions
  gnosis?: FakeSubgraphOptions
  mainnetFixture?: SubgraphFixture
} = {}): Sources {
  const { cli, ctx } = fakeCli(options)
  return {
    ctx,
    cli,
    mainnet: fakeSubgraph(options.mainnetFixture ?? mainnetFixture(), { hash: BLOCK_HASH, ...options.mainnet }),
    gnosis: fakeSubgraph(gnosisFixture(), { hash: GNOSIS_HASH, ...options.gnosis }),
    points: points(),
    sefFile: async (path) => sefFixture(path),
    build: { commit: null, run: null },
  }
}
