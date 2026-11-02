import { test } from "node:test"
import assert from "node:assert/strict"
import { parseUnits } from "viem"
import { ComplianceRefusal, DEFAULT_HISTORY_LIMIT, ScanError, type WriteMode } from "@cobuilders/safenet-cli/lib"
import { readConfig } from "./config.js"
import { library } from "./library.js"
import { fakeContext, VALIDATOR_A } from "../../cli/src/test-support.js"
import {
  BLOCK, connect, fakeLibrary, KEY_LIKE_VALUE, PASSWORD_VALUE, SIGNER_ADDRESS, STAKER, textOf, tripwire, VALIDATOR,
  WRITES_OFF, WRITES_ON,
} from "./test-support.js"

// The server against a fake library, over an in-memory transport. No network.

const SAFE = 10n ** 18n

/** Every write tool, with arguments that pass validation. */
const WRITES: readonly (readonly [string, Record<string, unknown>])[] = [
  ["stake", { validator: VALIDATOR, amount: "1" }],
  ["unstake", { validator: VALIDATOR, amount: "0.5" }],
  ["withdrawals_claim", { all: true }],
  ["rewards_claim", {}],
  ["rewards_claim_and_stake", { validator: VALIDATOR }],
]

// --- the tool list -----------------------------------------------------------------

test("lists eleven tools, the write tools marked read-only while writes are off", async () => {
  const off = await connect(WRITES_OFF)
  const { tools } = await off.client.listTools()
  assert.equal(tools.length, 11)
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object")
    assert.equal(t.annotations?.readOnlyHint, true, t.name)
  }
  assert.match(tools.find((t) => t.name === "stake")!.description!, /dry runs only/)
  await off.close()

  const on = await connect(WRITES_ON)
  const stake = (await on.client.listTools()).tools.find((t) => t.name === "stake")!
  assert.equal(stake.annotations?.readOnlyHint, false)
  assert.equal(stake.annotations?.destructiveHint, true)
  await on.close()
})

// --- each tool calls the library with the right arguments ------------------------

test("each read tool calls its library function with the parsed arguments", async () => {
  const cases: [string, Record<string, unknown>, string, unknown[]][] = [
    ["status", {}, "getStatus", []],
    ["validators_list", {}, "listValidators", [{ filter: "active", sort: "stake" }]],
    ["validators_list", { all: true, sort: "participation" }, "listValidators", [{ filter: "all", sort: "participation" }]],
    ["validators_show", { address: VALIDATOR.toLowerCase() }, "showValidator", [VALIDATOR]],
    ["withdrawals_list", {}, "networkWithdrawals", []],
    ["withdrawals_list", { address: STAKER }, "stakerWithdrawals", [STAKER]],
    ["rewards_check", { address: STAKER }, "checkRewards", [STAKER]],
    ["rewards_history", { address: STAKER }, "rewardsHistory", [STAKER, { limit: DEFAULT_HISTORY_LIMIT }]],
    ["rewards_history", { address: STAKER, all: true }, "rewardsHistory", [STAKER, { limit: null }]],
  ]
  for (const [name, args, fn, expected] of cases) {
    const fake = fakeLibrary()
    const s = await connect(WRITES_OFF, { fake })
    const r = await s.call(name, args)
    assert.ok(!r.isError, `${name}: ${textOf(r)}`)
    const libCalls = fake.calls.filter((c) => c.fn !== "createContext")
    assert.equal(libCalls.length, 1, name)
    assert.equal(libCalls[0]!.fn, fn, name)
    // The first argument is always the context.
    assert.equal(libCalls[0]!.args[0], fake.context, name)
    assert.deepEqual(libCalls[0]!.args.slice(1), expected, `${name} ${JSON.stringify(args)}`)
    await s.close()
  }
})

test("the context is made once, from the server's RPC setting", async () => {
  const fake = fakeLibrary()
  const config = readConfig({
    SAFENET_MCP_RPC_URL: "https://rpc.invalid/key", GITHUB_TOKEN: "token", IPFS_GATEWAY: "https://gw.invalid",
    SUBGRAPH_URL_MAINNET: "https://subgraph.invalid/query",
  })
  const s = await connect(config, { fake })
  await s.call("status")
  await s.call("status")
  const made = fake.calls.filter((c) => c.fn === "createContext")
  assert.deepEqual(made.map((c) => c.args), [[
    { rpcUrl: "https://rpc.invalid/key", githubToken: "token", ipfsGateway: "https://gw.invalid", subgraphUrl: "https://subgraph.invalid/query" },
  ]])
  await s.close()
})

test("each write tool calls its library function with the parsed input", async () => {
  const cases: [string, Record<string, unknown>, string, unknown[]][] = [
    ["stake", { validator: VALIDATOR, amount: "1.5", from: STAKER }, "stake",
      [{ validator: VALIDATOR, amount: parseUnits("1.5", 18), approve: "exact" }]],
    ["stake", { validator: VALIDATOR, amount: "2", approve: "unlimited", from: STAKER }, "stake",
      [{ validator: VALIDATOR, amount: 2n * SAFE, approve: "unlimited" }]],
    ["unstake", { validator: VALIDATOR, amount: "0.5", from: STAKER }, "unstake", [{ validator: VALIDATOR, amount: SAFE / 2n }]],
    ["withdrawals_claim", { id: "3", from: STAKER }, "claimWithdrawals", [3n]],
    ["withdrawals_claim", { all: true, from: STAKER }, "claimWithdrawals", ["all"]],
    ["rewards_claim", { from: STAKER }, "claimRewards", []],
    ["rewards_claim_and_stake", { validator: VALIDATOR, from: STAKER }, "claimAndStake",
      [{ validator: VALIDATOR, amount: undefined, approve: "exact" }]],
    ["rewards_claim_and_stake", { validator: VALIDATOR, amount: "0.25", from: STAKER }, "claimAndStake",
      [{ validator: VALIDATOR, amount: SAFE / 4n, approve: "exact" }]],
  ]
  for (const [name, args, fn, expected] of cases) {
    const fake = fakeLibrary()
    const s = await connect(WRITES_OFF, { fake })
    const r = await s.call(name, args)
    assert.ok(!r.isError, `${name}: ${textOf(r)}`)
    const libCalls = fake.calls.filter((c) => c.fn !== "createContext")
    assert.equal(libCalls.length, 1, name)
    const [ctx, mode, ...rest] = libCalls[0]!.args
    assert.equal(libCalls[0]!.fn, fn, name)
    assert.equal(ctx, fake.context)
    assert.deepEqual(mode, { dryRun: true, from: STAKER }, name)
    // The write options come last: for a dry run, the gates only, none of them asked for.
    assert.deepEqual(rest.slice(0, -1), expected, `${name} ${JSON.stringify(args)}`)
    assert.deepEqual(rest.at(-1), { compliance: { sanctionsEndpoint: null, geoCheck: false } }, name)
    await s.close()
  }
})

test("a result is structured content, the same JSON as --json, after a short summary", async () => {
  const s = await connect(WRITES_OFF)
  const r = await s.call("status")
  const structured = r.structuredContent as { block: string; totalStaked: { value: string } }
  assert.equal(structured.block, String(BLOCK))
  assert.equal(structured.totalStaked.value, String(5n * SAFE))
  assert.equal(r.content[0]?.type, "text")
  assert.match(textOf(r), /^Safenet at Ethereum Mainnet block 24000000: 5 SAFE staked, 3 active validators/)
  assert.deepEqual(JSON.parse((r.content[1] as { text: string }).text), structured)
  await s.close()
})

// --- the write gate ------------------------------------------------------------------

test("with writes off, dryRun: false is forced to a dry run, and the signer is never loaded or reached", async () => {
  for (const config of [WRITES_OFF, readConfig({ SAFENET_MCP_ALLOW_WRITES: "1" })]) {
    for (const [name, args] of WRITES) {
      const fake = fakeLibrary()
      const trip = tripwire()
      const s = await connect(config, { fake, trip })
      const r = await s.call(name, { ...args, dryRun: false, from: STAKER })
      assert.ok(!r.isError, `${name}: ${textOf(r)}`)
      assert.deepEqual(trip.loads, [], `${name} loaded the signer`)
      assert.deepEqual(trip.reached, [], `${name} reached the signer`)
      const modes = fake.calls.filter((c) => c.fn !== "createContext").map((c) => c.args[1] as WriteMode)
      assert.deepEqual(modes, [{ dryRun: true, from: STAKER }], name)
      const out = r.structuredContent as { dryRunForced: boolean; writesAllowed: boolean; dryRun: { dryRun: boolean }; execution: unknown }
      assert.equal(out.writesAllowed, false)
      assert.equal(out.dryRunForced, true)
      assert.equal(out.dryRun.dryRun, true)
      assert.equal(out.execution, null)
      assert.match(textOf(r), /^dryRun was forced to true: .*nothing was signed or sent/s)
      await s.close()
    }
  }
})

test("the tripwire works: with writes allowed, dryRun: false runs the dry run, then reaches the signer", async () => {
  // The control for the test above. Without it, a tripwire that could never fire would pass.
  for (const [name, args] of WRITES) {
    const fake = fakeLibrary()
    const trip = tripwire()
    const s = await connect(WRITES_ON, { fake, trip })
    const r = await s.call(name, { ...args, dryRun: false })
    assert.equal(r.isError, true, name)
    assert.equal(textOf(r), "the signer was reached.")
    assert.deepEqual(trip.reached, ["send"], name)
    const modes = fake.calls.filter((c) => c.fn !== "createContext").map((c) => (c.args[1] as WriteMode).dryRun)
    assert.deepEqual(modes, [true, false], `${name}: the dry run comes first`)
    await s.close()
  }
})

test("with writes allowed, dryRun defaults to true and simulates from the signer's address", async () => {
  const fake = fakeLibrary()
  const trip = tripwire()
  const s = await connect(WRITES_ON, { fake, trip })
  const r = await s.call("stake", { validator: VALIDATOR, amount: "1" })
  assert.ok(!r.isError, textOf(r))
  assert.deepEqual(trip.reached, [])
  const modes = fake.calls.filter((c) => c.fn === "stake").map((c) => c.args[1])
  assert.deepEqual(modes, [{ dryRun: true, from: SIGNER_ADDRESS }])
  assert.equal((r.structuredContent as { execution: unknown }).execution, null)
  await s.close()
})

test("with writes allowed, a live write returns the dry run, then the execution", async () => {
  const sent: string[] = []
  const trip = tripwire()
  const fake = fakeLibrary()
  const signer = { address: SIGNER_ADDRESS, send: async () => (sent.push("send"), `0x${"ab".repeat(32)}` as const) }
  const s = await connect(WRITES_ON, { fake, trip: { ...trip, loadSigner: async () => signer } })
  const r = await s.call("stake", { validator: VALIDATOR, amount: "1", dryRun: false })
  assert.ok(!r.isError, textOf(r))
  assert.deepEqual(sent, ["send"])
  const out = r.structuredContent as { dryRun: { dryRun: boolean }; execution: { dryRun: boolean; steps: { transaction: { hash: string } }[] } }
  assert.deepEqual(Object.keys(out), ["writesAllowed", "dryRunForced", "dryRun", "execution"])
  assert.equal(out.dryRun.dryRun, true)
  assert.equal(out.execution.dryRun, false)
  assert.equal(out.execution.steps[0]?.transaction.hash, `0x${"ab".repeat(32)}`)
  assert.match(textOf(r), /^Dry run from .* Sent 1 transaction from /s)
  await s.close()
})

test("with writes allowed, a from that is not the signer's address is refused", async () => {
  const fake = fakeLibrary()
  const s = await connect(WRITES_ON, { fake })
  const r = await s.call("stake", { validator: VALIDATOR, amount: "1", from: STAKER })
  assert.equal(r.isError, true)
  assert.match(textOf(r), /is not the signer's address/)
  assert.deepEqual(fake.calls.filter((c) => c.fn === "stake"), [])
  await s.close()
})

test("with writes off, a write without from is refused and says why", async () => {
  const s = await connect(WRITES_OFF)
  const r = await s.call("rewards_claim", {})
  assert.equal(r.isError, true)
  assert.match(textOf(r), /needs an address to simulate from: pass from\. This server has no signer, because the server was started without/)
  await s.close()
})

// --- no secret in, no secret out -----------------------------------------------------

test("a key or a password in a tool argument is refused without being repeated, and nothing runs", async () => {
  const attempts: [string, Record<string, unknown>][] = [
    ["stake", { validator: KEY_LIKE_VALUE, amount: "1", from: STAKER }],
    ["stake", { validator: VALIDATOR, amount: KEY_LIKE_VALUE.slice(2), from: STAKER }],
    ["stake", { validator: VALIDATOR, amount: "1", from: KEY_LIKE_VALUE }],
    ["stake", { validator: VALIDATOR, amount: "1", from: STAKER, privateKey: KEY_LIKE_VALUE }],
    ["rewards_claim", { from: STAKER, password: PASSWORD_VALUE }],
    ["rewards_claim", { from: STAKER, keystorePassword: PASSWORD_VALUE }],
    ["rewards_claim", { from: STAKER, privateKeyEnv: KEY_LIKE_VALUE }],
    ["stake", { validator: VALIDATOR, amount: "1", from: STAKER, approve: PASSWORD_VALUE }],
    ["stake", { validator: VALIDATOR, amount: PASSWORD_VALUE, from: STAKER }],
    ["rewards_check", { address: PASSWORD_VALUE }],
    ["validators_list", { sort: PASSWORD_VALUE }],
    ["withdrawals_claim", { id: PASSWORD_VALUE, from: STAKER }],
    ["status", { [KEY_LIKE_VALUE]: true }],
  ]
  for (const [name, args] of attempts) {
    const fake = fakeLibrary()
    const s = await connect(WRITES_OFF, { fake })
    const r = await s.call(name, args)
    const text = textOf(r)
    assert.equal(r.isError, true, `${name} accepted ${Object.keys(args).join(", ")}`)
    for (const secret of [KEY_LIKE_VALUE, KEY_LIKE_VALUE.slice(2), PASSWORD_VALUE]) {
      assert.ok(!text.includes(secret), `${name} repeated a secret: ${text}`)
    }
    assert.deepEqual(fake.calls, [], `${name} called the library`)
    await s.close()
  }
})

test("a signer argument is refused with the reason", async () => {
  const s = await connect(WRITES_OFF)
  const r = await s.call("stake", { validator: VALIDATOR, amount: "1", from: STAKER, password: PASSWORD_VALUE })
  assert.equal(textOf(r), "stake takes no signer argument. A key or a password never goes in a tool argument: " +
    "the operator configures the signer when the server starts")
  const k = await s.call("stake", { validator: VALIDATOR, amount: "1", from: KEY_LIKE_VALUE })
  assert.match(textOf(k), /^stake refused the argument from: it holds 64 hex digits/)
  const n = await s.call("status", { [KEY_LIKE_VALUE]: true })
  assert.match(textOf(n), /^status refused an argument name: it holds 64 hex digits/)
  await s.close()
})

test("bad arguments name the argument; unknown ones are listed", async () => {
  const s = await connect(WRITES_OFF)
  assert.match(textOf(await s.call("stake", { validator: VALIDATOR, amount: "0", from: STAKER })), /^amount must be more than zero$/)
  assert.match(textOf(await s.call("stake", { amount: "1", from: STAKER })), /^validator: /)
  assert.match(textOf(await s.call("validators_list", { active: true, all: true })), /^active and all cannot both be true$/)
  assert.match(textOf(await s.call("withdrawals_claim", { from: STAKER })), /^Name a withdrawal id, or set all/)
  assert.match(textOf(await s.call("status", { verbose: true })), /^status got 1 argument it does not take; it takes none$/)
  await s.close()
})

test("a library failure is one sentence with no URL, and a refused scan gets the server's advice", async () => {
  const url = "https://archive.invalid/v2/secret-key"
  const fake = fakeLibrary({
    getStatus: async () => {
      throw new Error(`request to ${url} failed\n    at somewhere (file.ts:1:1)`)
    },
    rewardsHistory: async () => {
      throw new ScanError("Reading Claimed logs failed")
    },
  })
  const s = await connect(WRITES_OFF, { fake })
  const status = await s.call("status")
  assert.equal(status.isError, true)
  assert.equal(textOf(status), "request to <url> failed.")
  const history = await s.call("rewards_history", { address: STAKER })
  assert.match(textOf(history), /^Reading Claimed logs failed; .*SAFENET_MCP_RPC_URL or MAINNET_RPC_URL/)
  await s.close()
})

test("an unknown tool is a protocol error that does not repeat a key", async () => {
  const s = await connect(WRITES_OFF)
  await assert.rejects(s.call(`tool_${KEY_LIKE_VALUE}`), (err: Error) => !err.message.includes(KEY_LIKE_VALUE.slice(2)))
  await s.close()
})

test("a live write reports each transaction on the log as it lands", async () => {
  const fake = fakeLibrary({
    stake: async (_ctx, mode, _input, options) => {
      if (!mode.dryRun) options?.onProgress?.({ type: "sent", contract: "Staking", functionName: "stake", hash: `0x${"cd".repeat(32)}` })
      return { dryRun: mode.dryRun, from: SIGNER_ADDRESS, block: BLOCK, steps: [] } as never
    },
  })
  const trip = tripwire()
  const s = await connect(WRITES_ON, { fake, trip })
  const r = await s.call("stake", { validator: VALIDATOR, amount: "1", dryRun: false })
  assert.ok(!r.isError, textOf(r))
  assert.deepEqual(s.logs, [`stake: sent Staking.stake: 0x${"cd".repeat(32)}, waiting for its receipt`])
  await s.close()
})

test("the rewards_history summary says how many periods the subgraph gave, and whether each matches the chain", async () => {
  const s = await connect(WRITES_OFF)
  const r = await s.call("rewards_history", { address: STAKER })
  assert.match(textOf(r),
    new RegExp(`2 distribution periods from the subgraph at block ${BLOCK}; each matches cumulativeClaimed on chain at its last block\\.`, "m"))
  assert.match(textOf(r), /Claim attribution uses approximate block windows; all update-block claims enter the new window, including earlier claims\./)
  await s.close()

  const down = fakeLibrary({
    rewardsHistory: (async () => ({
      block: BLOCK, address: STAKER, count: 0, claims: [], limited: false, totalClaimed: 0n, sumMatchesChain: true,
      periods: null, periodsReason: "the subgraph could not give the periods (the subgraph answered HTTP 502)",
    })) as never,
  })
  const d = await connect(WRITES_OFF, { fake: down })
  assert.match(textOf(await d.call("rewards_history", { address: STAKER })),
    / No periods: the subgraph could not give the periods \(the subgraph answered HTTP 502\)\.$/m)
  await d.close()
})

// --- compliance gates --------------------------------------------------------------------

test("real library refuses sanctioned addresses through every MCP write before signing", async () => {
  for (const config of [WRITES_OFF, WRITES_ON]) for (const [name, args] of WRITES) {
    const address = config.writes.allowed ? SIGNER_ADDRESS : STAKER
    const sends = { prepared: 0, broadcast: 0 }
    const ctx = fakeContext({ sanctioned: [address] }, sends)
    const fake = fakeLibrary({ ...library, createContext: () => ctx })
    const trip = tripwire(address)
    const s = await connect(config, { fake, trip })
    try {
      const r = await s.call(name, { ...args, ...(args.validator ? { validator: VALIDATOR_A } : {}), from: address, dryRun: false })
      assert.equal(r.isError, true, name)
      assert.match(textOf(r), /sanctions oracle: the address is on the sanctions list/)
      assert.equal((r.structuredContent as { refused: boolean }).refused, true)
      assert.deepEqual(trip.reached, [], name)
      assert.deepEqual(sends, { prepared: 0, broadcast: 0 }, name)
    } finally { await s.close() }
  }
})

test("MCP checks the oracle again when a dry run passes but the live run becomes sanctioned", async () => {
  for (const [name, args] of WRITES) {
    const sends = { prepared: 0, broadcast: 0 }
    const ctx = fakeContext({}, sends)
    const read = ctx.client.readContract
    let oracleReads = 0
    ctx.client.readContract = ((params) => params.functionName === "isSanctioned"
      ? Promise.resolve(++oracleReads > 1)
      : read(params)) as typeof read
    const fake = fakeLibrary({ ...library, createContext: () => ctx })
    const trip = tripwire(STAKER)
    const s = await connect(WRITES_ON, { fake, trip })
    try {
      const r = await s.call(name, { ...args, ...(args.validator ? { validator: VALIDATOR_A } : {}), dryRun: false })
      assert.equal(r.isError, true, `${name}: ${textOf(r)}`)
      assert.match(textOf(r), /sanctions oracle: the address is on the sanctions list/)
      assert.equal(oracleReads, 2, name)
      assert.deepEqual(trip.reached, [], name)
      assert.deepEqual(sends, { prepared: 0, broadcast: 0 }, name)
    } finally { await s.close() }
  }
})

/** WRITES_ON's settings, plus both opt-in gates. */
const GATES_ON = readConfig({
  SAFENET_MCP_ALLOW_WRITES: "1",
  SAFENET_MCP_PRIVATE_KEY_ENV: "SAFENET_TEST_KEY",
  SAFENET_TEST_KEY: "set",
  SAFENET_MCP_SANCTIONS_ENDPOINT: "https://sanctions.invalid/check",
  SAFENET_MCP_GEO_CHECK: "1",
})

test("the operator's gate settings reach the library's write options, for the dry run and the live run", async () => {
  for (const [name, args] of WRITES) {
    const fake = fakeLibrary()
    const trip = tripwire()
    const s = await connect(GATES_ON, { fake, trip })
    // The tripwire signer refuses the live send, after the library was called with its options.
    const r = await s.call(name, { ...args, dryRun: false })
    assert.equal(textOf(r), "the signer was reached.", name)
    const writes = fake.calls.filter((c) => c.fn !== "createContext")
    assert.equal(writes.length, 2, name)
    for (const call of writes) {
      const options = call.args.at(-1) as { compliance: unknown }
      assert.deepEqual(options.compliance, { sanctionsEndpoint: "https://sanctions.invalid/check", geoCheck: true }, name)
    }
    await s.close()
  }
})

test("a tool call cannot set or skip a gate: a gate argument is refused as unknown, and not repeated", async () => {
  for (const extra of [{ sanctionsEndpoint: "https://user:key@internal.invalid/" }, { geoCheck: false }]) {
    const fake = fakeLibrary()
    const s = await connect(WRITES_OFF, { fake })
    const r = await s.call("stake", { validator: VALIDATOR, amount: "1", from: STAKER, ...extra })
    assert.equal(r.isError, true)
    assert.match(textOf(r), /^stake got 1 argument it does not take; it takes validator, amount, approve, dryRun, from/)
    assert.doesNotMatch(textOf(r), /internal\.invalid|user:key|sanctionsEndpoint|geoCheck/)
    assert.deepEqual(fake.calls.filter((c) => c.fn !== "createContext"), [], "the library was called")
    await s.close()
  }
})

test("real endpoint errors expose no credentials through MCP text or structured content", async () => {
  const endpoint = "HTTPS://user:fixture-password@sanctions.invalid/check?key=fixture-token"
  const config = readConfig({ SAFENET_MCP_SANCTIONS_ENDPOINT: endpoint })
  const ctx = { ...fakeContext(), fetch: globalThis.fetch }
  const fake = fakeLibrary({ ...library, createContext: () => ctx })
  const s = await connect(config, { fake })
  try {
    const r = await s.call("stake", { validator: VALIDATOR_A, amount: "1", from: STAKER })
    assert.equal(r.isError, true)
    assert.doesNotMatch(JSON.stringify(r), /fixture-password|fixture-token|sanctions\.invalid|user:/)
    assert.match(textOf(r), /the endpoint did not answer, so the gate fails closed/)
    assert.equal((r.structuredContent as { refused: boolean }).refused, true)
  } finally { await s.close() }
})

test("a refused gate is a tool error: one sentence, and the report as structured content, with no URL", async () => {
  const report = {
    address: STAKER, block: BLOCK, allowed: false,
    gates: [{ gate: "sanctions oracle", checked: true, allowed: false, reason: "the address is on the sanctions list", source: "chain: SanctionsList.isSanctioned(address)" }],
  } as const
  const refuse = async () => {
    throw new ComplianceRefusal(report as never)
  }
  const config = readConfig({ SAFENET_MCP_SANCTIONS_ENDPOINT: "https://user:key@sanctions.invalid/check" })
  for (const [name, args] of WRITES) {
    const fake = fakeLibrary({ stake: refuse, unstake: refuse, claimWithdrawals: refuse, claimRewards: refuse, claimAndStake: refuse })
    const s = await connect(config, { fake })
    const r = await s.call(name, { ...args, from: STAKER })
    assert.equal(r.isError, true, name)
    assert.equal(textOf(r),
      `A compliance gate refused ${STAKER}, so nothing was signed or sent: sanctions oracle: the address is on the sanctions list.`)
    const structured = r.structuredContent as { refused: boolean; compliance: { block: string; allowed: boolean } }
    assert.equal(structured.refused, true)
    assert.equal(structured.compliance.allowed, false)
    assert.equal(structured.compliance.block, String(BLOCK))
    assert.doesNotMatch(JSON.stringify(r), /sanctions\.invalid|user:key/)
    await s.close()
  }
})

test("unreadable chain head returns structured compliance refusal without signing in MCP", async () => {
  const ctx = fakeContext()
  ctx.client.getBlockNumber = async () => { throw new Error("private-head-marker") }
  const fake = fakeLibrary({ ...library, createContext: () => ctx })
  const trip = tripwire(STAKER)
  const s = await connect(WRITES_ON, { fake, trip })
  try {
    const r = await s.call("stake", { validator: VALIDATOR_A, amount: "1", dryRun: false })
    assert.equal(r.isError, true)
    const structured = r.structuredContent as { refused: boolean; compliance: { block: null; allowed: boolean } }
    assert.equal(structured.refused, true)
    assert.equal(structured.compliance.block, null)
    assert.equal(structured.compliance.allowed, false)
    assert.doesNotMatch(JSON.stringify(r), /private-head-marker/)
    assert.deepEqual(trip.reached, [])
  } finally { await s.close() }
})

test("GRAPH_API_KEY is passed to context, never server output, with full URL precedence", async () => {
  for (const override of [undefined, "https://override.test/query"]) {
    const fake = fakeLibrary()
    const s = await connect(readConfig({ GRAPH_API_KEY: "test-only-private-marker", SUBGRAPH_URL_MAINNET: override }), { fake })
    try {
      const result = await s.call("status")
      const made = fake.calls.find((c) => c.fn === "createContext")!
      assert.equal((made.args[0] as { subgraphUrl: string }).subgraphUrl,
        override ?? "https://gateway.thegraph.com/api/test-only-private-marker/subgraphs/id/K1gHS5P5vZU3LApqchuuQxkmZGDDAUavkQUdGDV7Vxs")
      assert.doesNotMatch(JSON.stringify(result) + s.logs.join("\n"), /test-only-private-marker/)
    } finally { await s.close() }
  }
})
