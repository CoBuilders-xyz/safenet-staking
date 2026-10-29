/**
 * Option validation. commander parses the command line; zod decides whether the values make
 * sense, and turns them into the types the library takes.
 */
import { getAddress, isAddress, parseUnits } from "viem"
import { z } from "zod"
import { DEFAULT_HISTORY_LIMIT } from "../lib/index.js"

/** Bad input on the command line. The CLI exits 2. */
export class UsageError extends Error {
  override readonly name = "UsageError"
}

export function parseOptions<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new UsageError(result.error.issues[0]?.message ?? "invalid options")
}

/**
 * Lower case and upper case pass as they are. Mixed case must carry a valid checksum, because a
 * wrong one usually means a mistyped character.
 */
export const addressSchema = z
  .string()
  .trim()
  .refine((s) => isAddress(s), {
    error: (issue) => `"${String(issue.input)}" is not an Ethereum address, or its checksum is wrong`,
  })
  .transform((s) => getAddress(s))

export const globalSchema = z.object({
  json: z.boolean().default(false),
  verbose: z.boolean().default(false),
  // Any host, so an Anvil fork on localhost, 127.0.0.1, [::1] or a container name works.
  // The message does not repeat the value: an RPC URL can carry a key.
  rpcUrl: z.url({ protocol: /^https?$/, error: "--rpc-url must be an http or https URL" }).optional(),
})
export type GlobalOptions = z.output<typeof globalSchema>

export const validatorsListSchema = z
  .object({
    active: z.boolean().optional(),
    all: z.boolean().optional(),
    sort: z.enum(["stake", "participation"], {
      error: (issue) => `--sort takes "stake" or "participation", not "${String(issue.input)}"`,
    }).default("stake"),
  })
  .refine((o) => !(o.active && o.all), { error: "--active and --all cannot be used together" })
  .transform((o) => ({ filter: o.all ? ("all" as const) : ("active" as const), sort: o.sort }))

export const withdrawalsListSchema = z.object({ address: addressSchema.optional() })

export const historySchema = z
  .object({ all: z.boolean().optional() })
  .transform((o) => ({ limit: o.all ? null : DEFAULT_HISTORY_LIMIT }))

/** An amount of SAFE as a person types it: "100", "0.5". Exact, up to 18 decimals, above zero. */
export const safeAmountSchema = z
  .string()
  .trim()
  .refine((s) => /^\d+(\.\d{1,18})?$/.test(s), {
    error: (issue) => `"${String(issue.input)}" is not a SAFE amount: write a number such as 100 or 0.5, with at most 18 decimals`,
  })
  .transform((s) => parseUnits(s, 18))
  .refine((wei) => wei > 0n, { error: "The amount must be more than zero" })

export const approveSchema = z.enum(["exact", "unlimited"], {
  error: (issue) => `--approve takes "exact" or "unlimited", not "${String(issue.input)}"`,
}).default("exact")

/**
 * The name of an environment variable. A value that looks like a key is refused without being
 * repeated: the user passed the key itself, and it must not be printed back.
 */
const envName = (flag: string) =>
  z.string().refine((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !/^(0x)?[0-9a-fA-F]{40,}$/.test(s), {
    error: `${flag} takes the name of an environment variable that holds the secret, never the secret itself`,
  })

export const writeSchema = z
  .object({
    dryRun: z.boolean().default(false),
    privateKeyEnv: envName("--private-key-env").optional(),
    walletconnect: z.boolean().default(false),
    walletAccount: addressSchema.optional(),
    keystore: z.string().min(1).optional(),
    passwordEnv: envName("--password-env").optional(),
    from: addressSchema.optional(),
  })
  .refine((o) => !(o.privateKeyEnv && o.keystore), { error: "--private-key-env and --keystore cannot be used together" })
  .refine((o) => !o.walletconnect || !(o.privateKeyEnv || o.keystore), { error: "Choose only one signer mode" })
  .refine((o) => o.walletconnect === Boolean(o.walletAccount), { error: "--walletconnect requires --wallet-account <address>, and vice versa" })
  .refine((o) => !o.passwordEnv || o.keystore, { error: "--password-env only works with --keystore" })
  .refine((o) => !o.from || o.dryRun, {
    error: "--from only works with --dry-run: a transaction is sent from the signer's address",
  })
  .refine((o) => o.dryRun || o.privateKeyEnv || o.keystore || o.walletconnect, {
    error: "Sending a transaction needs a signer: pass --private-key-env <NAME> or --keystore <path> or --walletconnect --wallet-account <address>, or use --dry-run",
  })
  .refine((o) => !o.dryRun || o.from || o.privateKeyEnv || o.keystore || o.walletconnect, {
    error: "A dry run needs an address to simulate from: pass --from <address>, or a signer option",
  })
  .transform((o) => ({
    dryRun: o.dryRun,
    from: o.from ?? null,
    signer: o.privateKeyEnv
      ? ({ kind: "private-key-env", name: o.privateKeyEnv } as const)
      : o.keystore
        ? ({ kind: "keystore", path: o.keystore, passwordEnv: o.passwordEnv ?? null } as const)
        : o.walletconnect
          ? ({ kind: "walletconnect", address: o.walletAccount! } as const)
          : null,
  }))
export type WriteRequest = z.output<typeof writeSchema>

export const stakeSchema = z.object({ approve: approveSchema })

export const claimAndStakeSchema = z.object({ approve: approveSchema, amount: safeAmountSchema.optional() })

export const withdrawalClaimSchema = z
  .object({
    id: z.string().regex(/^\d+$/, { error: (issue) => `"${String(issue.input)}" is not a withdrawal id: ids are whole numbers` }).optional(),
    all: z.boolean().optional(),
  })
  .refine((o) => !(o.id && o.all), { error: "Name one withdrawal id or pass --all, not both" })
  .refine((o) => o.id || o.all, { error: "Name a withdrawal id, or pass --all to claim every claimable one" })
  .transform((o) => (o.all ? ("all" as const) : BigInt(o.id!)))
