/**
 * The tools: one per `safenet` command, under the command's path joined with underscores, with
 * the command's arguments and options under the same names in camel case. `src/parity.test.ts`
 * walks the CLI's commands and fails when a command has no tool or the shapes drift.
 *
 * The schemas validate what the CLI validates, but no message repeats the value it refuses: a
 * model may put a key or a password where an address or an amount belongs.
 */
import { getAddress, isAddress, parseUnits, type Address } from "viem"
import { z } from "zod"
import {
  DEFAULT_HISTORY_LIMIT,
  type ApprovalKind, type Context, type NetworkWithdrawals, type StakerWithdrawals,
  type WriteMode, type WriteOptions, type WriteResultBase,
} from "@cobuilders/safenet-cli/lib"
import type { Library } from "./library.js"
import {
  rewardsCheckSummary, rewardsHistorySummary, statusSummary, validatorListSummary, validatorSummary, withdrawalsSummary,
} from "./summary.js"

const address = (name: string, about: string) =>
  z
    .string()
    .trim()
    .refine((s) => isAddress(s), {
      error: `${name} must be an Ethereum address: 0x and 40 hex digits, with a valid checksum when the case is mixed`,
    })
    .transform((s): Address => getAddress(s))
    .describe(about)

/** An amount of SAFE as a person writes it: "100", "0.5". Exact, up to 18 decimals, above zero. */
const safeAmount = (name: string, about: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,18})?$/, {
      error: `${name} must be a SAFE amount written as a number, such as 100 or 0.5, with at most 18 decimals`,
    })
    .transform((s) => parseUnits(s, 18))
    .refine((wei) => wei > 0n, { error: `${name} must be more than zero` })
    .describe(about)

const approve = z
  .enum(["exact", "unlimited"], { error: 'approve takes "exact" or "unlimited"' })
  .default("exact")
  .describe("When the SAFE allowance is below the amount: approve exactly the amount, or an unlimited amount")

const flag = (about: string) => z.boolean({ error: "this argument takes true or false" }).optional().describe(about)

/** What every write takes, beyond its own arguments. */
const writeArgs = {
  dryRun: z
    .boolean({ error: "dryRun takes true or false" })
    .default(true)
    .describe(
      "Read, simulate and estimate every transaction, and return what would be sent; nothing is signed. " +
        "Forced to true unless the server was started with writes allowed and a signer.",
    ),
  from: address(
    "from",
    "The address a dry run simulates from. Required when the server has no signer; when it has one, it must be the signer's address",
  ).optional(),
}

export type Kind = "read" | "write"

interface BaseTool<S extends z.ZodType> {
  /** The tool's name: the command path joined with "_", hyphens as "_". */
  readonly name: string
  /** The `safenet` command it mirrors. */
  readonly command: readonly string[]
  readonly kind: Kind
  readonly description: string
  readonly input: S
}

export interface ReadTool<S extends z.ZodType = z.ZodType, R = unknown> extends BaseTool<S> {
  readonly kind: "read"
  readonly run: (lib: Library, ctx: Context, args: z.output<S>) => Promise<R>
  /** One or two sentences with the headline figures, next to the structured result. */
  readonly summary: (result: R) => string
}

export interface WriteRequest {
  readonly dryRun: boolean
  readonly from: Address | undefined
}

export interface WriteTool<S extends z.ZodType = z.ZodType> extends BaseTool<S> {
  readonly kind: "write"
  readonly request: (args: z.output<S>) => WriteRequest
  readonly run: (lib: Library, ctx: Context, mode: WriteMode, args: z.output<S>, options: WriteOptions) => Promise<WriteResultBase>
}

export type Tool = ReadTool | WriteTool

// Each helper keeps the schema's own type for `run`, then widens it for the list.
const read = <S extends z.ZodType, R>(tool: Omit<ReadTool<S, R>, "kind">): Tool => ({ ...tool, kind: "read" }) as unknown as Tool
const write = <S extends z.ZodType>(tool: Omit<WriteTool<S>, "kind" | "request">): Tool =>
  ({
    ...tool,
    kind: "write",
    request: (args: WriteRequest) => ({ dryRun: args.dryRun, from: args.from }),
  }) as unknown as Tool

const validatorArg = address("validator", "The validator's address")
const stakerArg = address("address", "The staker's address")

export const TOOLS: readonly Tool[] = [
  read({
    name: "status",
    command: ["status"],
    description: "Network totals on Ethereum Mainnet: stake, validators, pending withdrawals, rewards and the Merkle root, each with its source.",
    input: z.strictObject({}),
    run: (lib, ctx) => lib.getStatus(ctx),
    summary: statusSummary,
  }),
  read({
    name: "validators_list",
    command: ["validators", "list"],
    description: "Every validator SEF lists, with stake and registration from the chain and participation, commission and active from SEF. " +
      "Participation is null when SEF publishes no rate, never 0.",
    input: z
      .strictObject({
        active: flag("Only validators SEF marks active (the default)"),
        all: flag("Include validators SEF marks inactive"),
        sort: z
          .enum(["stake", "participation"], { error: 'sort takes "stake" or "participation"' })
          .default("stake")
          .describe("Sort by stake or participation, highest first"),
      })
      .refine((o) => !(o.active && o.all), { error: "active and all cannot both be true" })
      .transform((o) => ({ filter: o.all ? ("all" as const) : ("active" as const), sort: o.sort })),
    run: (lib, ctx, args) => lib.listValidators(ctx, args),
    summary: validatorListSummary,
  }),
  read({
    name: "validators_show",
    command: ["validators", "show"],
    description: "One validator, with its delegators count. The count needs an archive RPC endpoint; without one it is marked unavailable. " +
      "Participation is null when SEF publishes no rate, never 0.",
    input: z.strictObject({ address: address("address", "The validator's address") }),
    run: (lib, ctx, args) => lib.showValidator(ctx, args.address),
    summary: validatorSummary,
  }),
  read({
    name: "withdrawals_list",
    command: ["withdrawals", "list"],
    description: "Pending withdrawals: the network total and count, or one staker's queue when address is given. The network count needs an archive RPC endpoint.",
    input: z.strictObject({ address: address("address", "One staker's pending withdrawals").optional() }),
    run: (lib, ctx, args): Promise<NetworkWithdrawals | StakerWithdrawals> =>
      args.address ? lib.stakerWithdrawals(ctx, args.address) : lib.networkWithdrawals(ctx),
    summary: withdrawalsSummary,
  }),
  read({
    name: "rewards_check",
    command: ["rewards", "check"],
    description: "An address's rewards: earned, claimed, claimable and held amounts, and whether SEF's proof matches the root on chain.",
    input: z.strictObject({ address: stakerArg }),
    run: (lib, ctx, args) => lib.checkRewards(ctx, args.address),
    summary: rewardsCheckSummary,
  }),
  read({
    name: "rewards_history",
    command: ["rewards", "history"],
    description: `An address's reward claims, newest first, the newest ${DEFAULT_HISTORY_LIMIT} unless all is true. Needs an archive RPC endpoint.`,
    input: z
      .strictObject({ address: stakerArg, all: flag(`Every claim, not only the newest ${DEFAULT_HISTORY_LIMIT}`) })
      .transform((o) => ({ address: o.address, limit: o.all ? null : DEFAULT_HISTORY_LIMIT })),
    run: (lib, ctx, args) => lib.rewardsHistory(ctx, args.address, { limit: args.limit }),
    summary: rewardsHistorySummary,
  }),
  write({
    name: "stake",
    command: ["stake"],
    description: "Stake SAFE on a validator, approving the staking contract first when the allowance is short.",
    input: z.strictObject({
      validator: validatorArg,
      amount: safeAmount("amount", "SAFE to stake, such as 100 or 0.5"),
      approve,
      ...writeArgs,
    }),
    run: (lib, ctx, mode, args, options) =>
      lib.stake(ctx, mode, { validator: args.validator, amount: args.amount, approve: args.approve as ApprovalKind }, options),
  }),
  write({
    name: "unstake",
    command: ["unstake"],
    description: "Start a withdrawal of SAFE staked on a validator. It becomes claimable after the delay.",
    input: z.strictObject({
      validator: validatorArg,
      amount: safeAmount("amount", "SAFE to withdraw, such as 100 or 0.5"),
      ...writeArgs,
    }),
    run: (lib, ctx, mode, args, options) =>
      lib.unstake(ctx, mode, { validator: args.validator, amount: args.amount }, options),
  }),
  write({
    name: "withdrawals_claim",
    command: ["withdrawals", "claim"],
    description: "Claim withdrawals past their delay. claimWithdrawal() pays the oldest first, so an id claims every one up to it.",
    input: z
      .strictObject({
        id: z
          .string()
          .regex(/^\d+$/, { error: "id must be a withdrawal id, a whole number" })
          .optional()
          .describe("Claim up to and including this withdrawal"),
        all: flag("Claim every withdrawal past its delay"),
        ...writeArgs,
      })
      .refine((o) => !(o.id && o.all), { error: "Name one withdrawal id or set all, not both" })
      .refine((o) => o.id || o.all, { error: "Name a withdrawal id, or set all to claim every claimable one" }),
    run: (lib, ctx, mode, args, options) =>
      lib.claimWithdrawals(ctx, mode, args.all ? "all" : BigInt(args.id!), options),
  }),
  write({
    name: "rewards_claim",
    command: ["rewards", "claim"],
    description: "Claim the signer's rewards with SEF's published proof, while its root is the root on chain.",
    input: z.strictObject({ ...writeArgs }),
    run: (lib, ctx, mode, _args, options) => lib.claimRewards(ctx, mode, options),
  }),
  write({
    name: "rewards_claim_and_stake",
    command: ["rewards", "claim-and-stake"],
    description: "Claim the signer's rewards, then approve and stake what arrived on a validator, one transaction after another.",
    input: z.strictObject({
      validator: validatorArg,
      amount: safeAmount(
        "amount",
        "Stake this much SAFE and leave the rest in the wallet; more than the claimable amount is refused before anything is sent",
      ).optional(),
      approve,
      ...writeArgs,
    }),
    run: (lib, ctx, mode, args, options) =>
      lib.claimAndStake(ctx, mode, { validator: args.validator, amount: args.amount, approve: args.approve as ApprovalKind }, options),
  }),
]

/** The JSON Schema a client sees: the input side of the zod schema, before any transform. */
export function inputJsonSchema(tool: Tool): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>
  return schema
}
