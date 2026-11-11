import assert from "node:assert/strict"
import { test } from "node:test"
import { networkWithdrawals, type Context } from "@cobuilders/safenet-cli/lib"
import { CONTRACTS, SEF_DATA, ensResolverAbi, ensUniversalResolverAbi, readRewardsEnsState } from "@cobuilders/safenet-core"
import { encodeFunctionResult, numberToHex, pad, type PublicClient } from "viem"
import { pinClient, pinContext, pinFetch, type SefPin } from "./pinned.js"
import { COMMIT, REWARDS_COMMIT } from "./test-support.js"

const PIN = 100n

function recordingClient() {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  const record = (method: string) => async (args: Record<string, unknown> = {}) => {
    calls.push({ method, args })
    return method === "getBlockNumber" ? 999n : "ok"
  }
  const client = {
    chain: { id: 1 },
    getBlockNumber: record("getBlockNumber"),
    getBlock: record("getBlock"),
    readContract: record("readContract"),
    getLogs: record("getLogs"),
    getBalance: record("getBalance"),
    request: record("request"),
  } as unknown as PublicClient
  return { client, calls }
}

test("the head is the pinned block, without asking the RPC", async () => {
  const { client, calls } = recordingClient()
  assert.equal(await pinClient(client, PIN).getBlockNumber(), PIN)
  assert.equal(calls.length, 0)
})

test("a contract read and a block read with no block are held at the pin", async () => {
  const { client, calls } = recordingClient()
  const pinned = pinClient(client, PIN)
  await pinned.readContract({ functionName: "x" } as never)
  await pinned.getBlock()
  assert.deepEqual(calls.map((c) => c.args.blockNumber), [PIN, PIN])
})

test("an earlier block is kept, a later one or a tag is refused", async () => {
  const { client, calls } = recordingClient()
  const pinned = pinClient(client, PIN)
  await pinned.readContract({ functionName: "x", blockNumber: 50n } as never)
  assert.equal(calls[0]!.args.blockNumber, 50n)
  assert.throws(() => pinned.readContract({ functionName: "x", blockNumber: 101n } as never), /after the pinned block 100/)
  assert.throws(() => pinned.getBlock({ blockTag: "latest" }), /asked for the latest block/)
})

test("a log scan must end at or before the pin", async () => {
  const { client } = recordingClient()
  const pinned = pinClient(client, PIN)
  await pinned.getLogs({ fromBlock: 1n, toBlock: PIN } as never)
  assert.throws(() => pinned.getLogs({ fromBlock: 1n, toBlock: 101n } as never), /reaches past the pinned block/)
  assert.throws(() => pinned.getLogs({ fromBlock: 1n } as never), /reaches past the pinned block/)
})

test("raw ENS eth_call reads latest at the snapshot block, preserving the request", async () => {
  const { client, calls } = recordingClient()
  const pinned = pinClient(client, PIN)
  const transaction = { to: "0x0000000000000000000000000000000000000001", data: "0x1234" }
  await pinned.request({ method: "eth_call", params: [transaction, "latest"] } as never)
  await pinned.request({ method: "eth_call", params: [transaction] } as never)
  assert.deepEqual(calls.map((c) => c.args.params), [[transaction, "0x64"], [transaction, "0x64"]])
})

test("raw eth_call preserves earlier blocks and refuses later or unsupported block selectors", async () => {
  const { client, calls } = recordingClient()
  const pinned = pinClient(client, PIN)
  const transaction = { data: "0x" }
  await pinned.request({ method: "eth_call", params: [transaction, "0x32"] } as never)
  assert.deepEqual(calls[0]!.args.params, [transaction, "0x32"])
  for (const selector of ["0x65", "pending", "finalized", { blockHash: "0x1234" }]) {
    assert.throws(() => pinned.request({ method: "eth_call", params: [transaction, selector] } as never), /eth_call.*pinned block 100/)
  }
  assert.equal(calls.length, 1)
})

test("the core ENS resolver reads its contenthash at the snapshot block", async () => {
  const blocks: unknown[] = []
  const client = {
    request: async ({ params }: { params: readonly unknown[] }) => {
      blocks.push(params[1])
      const answer = encodeFunctionResult({ abi: ensResolverAbi, functionName: "contenthash", result: "0x" })
      return encodeFunctionResult({
        abi: ensUniversalResolverAbi, functionName: "resolve",
        result: [answer, pad(numberToHex(1), { size: 20 })],
      })
    },
  } as unknown as PublicClient
  assert.deepEqual(await readRewardsEnsState(pinClient(client, PIN)), { status: "empty" })
  assert.deepEqual(blocks, ["0x64"])
})

test("a read the snapshot does not pin is refused by name; viem's plumbing stays reachable", async () => {
  const { client } = recordingClient()
  const pinned = pinClient(client, PIN)
  assert.throws(() => pinned.getBalance({ address: "0x0" } as never), /getBalance is not pinned/)
  assert.equal(await pinned.request({ method: "eth_chainId" } as never), "ok")
  assert.deepEqual(pinned.chain, { id: 1 })
})

const PINS: SefPin[] = [
  { path: "validator-info.json", commit: COMMIT, publishedAt: new Date("2026-10-27T22:18:42Z") },
  { path: "rewards/latest.json", commit: REWARDS_COMMIT, publishedAt: new Date("2026-10-21T10:26:37Z") },
]

function countingFetch() {
  const urls: string[] = []
  const base = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    return new Response(`body of ${url}`, { status: 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
  return { base, urls }
}

test("a read of SEF's main is a read at the pinned commit, fetched once", async () => {
  const { base, urls } = countingFetch()
  const { fetch } = pinFetch(base, PINS)
  const a = await (await fetch(SEF_DATA.validatorInfo)).text()
  const b = await (await fetch(SEF_DATA.validatorInfo)).text()
  assert.equal(a, b)
  assert.deepEqual(urls, [`${SEF_DATA.assetsAtCommit(COMMIT)}/validator-info.json`])
  await fetch(SEF_DATA.rewardsLatest)
  assert.equal(urls[1], `${SEF_DATA.assetsAtCommit(REWARDS_COMMIT)}/rewards/latest.json`)
})

test("the commits API is answered with the pin, so the CLI's window comes from the same commit", async () => {
  const { base, urls } = countingFetch()
  const { fetch } = pinFetch(base, PINS)
  const body = (await (await fetch(SEF_DATA.validatorInfoCommits)).json()) as { sha: string; commit: { committer: { date: string } } }[]
  assert.equal(body[0]!.sha, COMMIT)
  assert.equal(body[0]!.commit.committer.date, "2026-10-27T22:18:42.000Z")
  assert.equal(urls.length, 0)
})

test("a file of SEF's main with no pin is refused, not read from main", async () => {
  const { base } = countingFetch()
  const { fetch } = pinFetch(base, PINS)
  await assert.rejects(fetch(SEF_DATA.networkInfo), /pinned no commit for it/)
  await assert.rejects(fetch(SEF_DATA.networkInfoCommits), /pinned no commit for SEF's network-info\.json/)
})

test("the snapshot's copy of a SEF file is the bytes the CLI read", async () => {
  const { base, urls } = countingFetch()
  const pinned = pinFetch(base, PINS)
  const read = await (await pinned.fetch(SEF_DATA.validatorInfo)).text()
  assert.equal(new TextDecoder().decode(await pinned.sefFile("validator-info.json")), read)
  assert.equal(urls.length, 1)
})

test("a SEF file the commit does not have fails, rather than copy an error page", async () => {
  const base = (async () => new Response("Not Found", { status: 404 })) as typeof fetch
  await assert.rejects(pinFetch(base, PINS).sefFile("validator-info.json"), /answered HTTP 404/)
})

test("a query with a body is refused and never answered from memory", async () => {
  const { base, urls } = countingFetch()
  const { fetch } = pinFetch(base, PINS)
  const url = "https://api.studio.thegraph.com/query/1/safenet-mainnet/version/latest"
  await assert.rejects(fetch(url, { method: "POST", body: "{}" }), /reads the subgraphs itself/)
  await assert.rejects(fetch(new Request(url, { method: "POST", body: "{}" })), /reads the subgraphs itself/)
  assert.equal(urls.length, 0)
})

// The builder hands the CLI library's own operations a pinned context. These tests run the real
// operations through it, so a read the library adds that the pin does not cover fails here, not
// in the nightly run (issue #95: getChainId, added to networkWithdrawals).
const AFTER_DEPLOY = CONTRACTS.staking.deployBlock + 10n

function mainnetClient() {
  const calls: string[] = []
  const client = {
    chain: { id: 1 },
    getChainId: async () => { calls.push("getChainId"); return 1 },
    getBlockNumber: async () => { calls.push("getBlockNumber"); return AFTER_DEPLOY + 1_000n },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: `0x${"ab".repeat(32)}`, timestamp: 1n }),
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      calls.push(`readContract ${functionName} at ${blockNumber}`)
      if (functionName === "totalPendingWithdrawals") return 0n
      throw new Error(`unexpected read ${functionName}`)
    },
    getLogs: async ({ toBlock }: { toBlock: bigint }) => { calls.push(`getLogs to ${toBlock}`); return [] },
  } as unknown as PublicClient
  return { client, calls }
}

test("getChainId reaches the RPC: a chain id is the same at every block", async () => {
  const { client, calls } = mainnetClient()
  assert.equal(await pinClient(client, PIN).getChainId(), 1)
  assert.deepEqual(calls, ["getChainId"])
})

test("the CLI's networkWithdrawals runs under the pinned context, from the chain alone", async () => {
  const { client, calls } = mainnetClient()
  const { base, urls } = countingFetch()
  const ctx: Context = { client, fetch: base, retryDelayMs: 0 }
  const result = await networkWithdrawals(pinContext(ctx, AFTER_DEPLOY, pinFetch(base, PINS)))
  assert.equal(result.block, AFTER_DEPLOY)
  assert.equal(result.logsMatchChain, true)
  // The figure comes from the chain's logs, so the check against the subgraph's rows stays independent.
  assert.match(result.count.source, /^chain: WithdrawalInitiated logs/)
  assert.equal(urls.length, 0, "no subgraph query left the pinned fetch")
  assert.ok(calls.includes("getChainId"))
  assert.ok(calls.includes(`readContract totalPendingWithdrawals at ${AFTER_DEPLOY}`))
  assert.ok(calls.filter((c) => c.startsWith("getLogs")).every((c) => BigInt(c.slice("getLogs to ".length)) <= AFTER_DEPLOY))
  assert.ok(!calls.includes("getBlockNumber"), "the head is the pinned block")
})
