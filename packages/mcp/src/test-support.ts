/**
 * A fake library that records every call, a signer that throws when reached, and a client
 * connected to the server in memory. No network.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { getAddress, numberToHex, pad, type Address } from "viem"
import type { Context, Signer, Step, WriteMode, WriteResultBase } from "@cobuilders/safenet-cli/lib"
import { readConfig, type ServerConfig, type SignerRequest } from "./config.js"
import type { Library } from "./library.js"
import { createServer } from "./server.js"

export const fakeAddress = (n: number): Address => getAddress(pad(numberToHex(n), { size: 20 }))
export const fakeHash = (n: number) => pad(numberToHex(n), { size: 32 })

export const VALIDATOR = fakeAddress(0xa1)
export const STAKER = fakeAddress(0x5)
export const SIGNER_ADDRESS = fakeAddress(0x7)

/** What a private key looks like, built rather than typed. */
export const KEY_LIKE_VALUE = `0x${"5a".repeat(32)}`
export const PASSWORD_VALUE = "correct-horse-battery-staple-41"

export interface LibraryCall {
  readonly fn: keyof Library
  readonly args: readonly unknown[]
}

const FAKE_CONTEXT = { fake: "context" } as unknown as Context

/** The block every fake result reports. */
export const BLOCK = 24_000_000n

const figure = <T>(value: T) => ({ value, source: "fake" })

/** A write result: one step, sent when the mode has a signer, which the fake asks to send. */
async function writeResult(mode: WriteMode, extra: Record<string, unknown>): Promise<WriteResultBase> {
  const step = (transaction: Step["transaction"]): Step => ({
    contract: "Staking",
    to: VALIDATOR,
    function: "stake(address validator, uint256 amount)",
    args: {},
    data: "0x",
    gas: figure(21_000n),
    transaction,
  })
  if (mode.dryRun) return { ...extra, dryRun: true, from: mode.from, block: BLOCK, steps: [step(null)] } as WriteResultBase
  const hash = await mode.signer.send({ to: VALIDATOR, data: "0x", gas: 21_000n })
  return {
    ...extra,
    dryRun: false,
    from: mode.signer.address,
    block: BLOCK,
    steps: [step({ hash, status: "success", block: BLOCK + 1n, gasUsed: 21_000n })],
  } as WriteResultBase
}

/** A library whose functions record their arguments and return small, well-formed results. */
export function fakeLibrary(overrides: Partial<Library> = {}) {
  const calls: LibraryCall[] = []
  const record = <F extends keyof Library>(fn: F, impl: (...args: never[]) => unknown) =>
    ((...args: never[]) => {
      calls.push({ fn, args })
      return impl(...args)
    }) as unknown as Library[F]
  const window = { days: 14, from: null, to: null, source: "fake" }
  const lib: Library = {
    createContext: record("createContext", () => FAKE_CONTEXT),
    getStatus: record("getStatus", async () => ({
      block: BLOCK,
      totalStaked: figure(5n * 10n ** 18n),
      activeValidators: figure(3),
      pendingWithdrawals: figure(10n ** 18n),
      merkleRoot: { match: true },
    })),
    listValidators: record("listValidators", async () => ({ block: BLOCK, filter: "active", sort: "stake", window, validators: [] })),
    showValidator: record("showValidator", async () => ({
      block: BLOCK,
      window,
      validator: { address: VALIDATOR, label: "fake", active: true, registered: true, stake: 10n ** 18n },
      delegators: { value: { current: 1, ever: 2 }, source: "fake" },
    })),
    networkWithdrawals: record("networkWithdrawals", async () => ({
      scope: "network", block: BLOCK, total: figure(0n), count: figure(0), logsMatchChain: true,
    })),
    stakerWithdrawals: record("stakerWithdrawals", async () => ({
      scope: "address", block: BLOCK, address: STAKER, withdrawals: figure([]), total: 0n,
    })),
    checkRewards: record("checkRewards", async () => ({
      block: BLOCK, address: STAKER, earned: false, claimed: figure(0n),
    })),
    rewardsHistory: record("rewardsHistory", async () => ({
      block: BLOCK, address: STAKER, count: 0, claims: [], limited: false, totalClaimed: 0n, sumMatchesChain: true,
    })),
    stake: record("stake", (_ctx: Context, mode: WriteMode) => writeResult(mode, { operation: "stake" })),
    unstake: record("unstake", (_ctx: Context, mode: WriteMode) => writeResult(mode, { operation: "unstake" })),
    claimWithdrawals: record("claimWithdrawals", (_ctx: Context, mode: WriteMode) => writeResult(mode, { operation: "withdrawals claim" })),
    claimRewards: record("claimRewards", (_ctx: Context, mode: WriteMode) => writeResult(mode, { operation: "rewards claim" })),
    claimAndStake: record("claimAndStake", (_ctx: Context, mode: WriteMode) => writeResult(mode, { operation: "rewards claim-and-stake" })),
    ...overrides,
  } as Library
  return { lib, calls, context: FAKE_CONTEXT }
}

/**
 * A signer whose `send` throws and counts the attempt, and a loader that counts its own calls.
 * Reaching either while writes are off is the failure the gating tests exist to catch.
 */
export function tripwire(address: Address = SIGNER_ADDRESS) {
  const reached: string[] = []
  const loads: SignerRequest[] = []
  const signer: Signer = {
    address,
    send: async () => {
      reached.push("send")
      throw new Error("the signer was reached")
    },
  }
  const loadSigner = async (request: SignerRequest): Promise<Signer> => {
    loads.push(request)
    return signer
  }
  return { reached, loads, loadSigner }
}

export const WRITES_OFF: ServerConfig = readConfig({})
/** Writes allowed, with a key variable that the tripwire loader never reads. */
export const WRITES_ON: ServerConfig = readConfig({
  SAFENET_MCP_ALLOW_WRITES: "1",
  SAFENET_MCP_PRIVATE_KEY_ENV: "SAFENET_TEST_KEY",
  SAFENET_TEST_KEY: "set",
})

/** A client connected in memory to a server built with the given config and fakes. */
export async function connect(
  config: ServerConfig,
  options: { fake?: ReturnType<typeof fakeLibrary>; trip?: ReturnType<typeof tripwire> } = {},
) {
  const { lib, calls } = options.fake ?? fakeLibrary()
  const trip = options.trip ?? tripwire()
  const logs: string[] = []
  const server = createServer(config, { lib, loadSigner: trip.loadSigner, log: (l) => logs.push(l) })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0" })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult
  return { client, call, logs, calls, trip, close: () => client.close() }
}

/** The text of a result's content, joined. */
export const textOf = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
