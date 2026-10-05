/**
 * Option validation. commander parses the command line; zod decides whether the values make
 * sense, and turns them into the types the library takes.
 */
import { getAddress, isAddress } from "viem"
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
