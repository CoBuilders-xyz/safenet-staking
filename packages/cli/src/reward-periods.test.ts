import { test } from "node:test"
import assert from "node:assert/strict"
import { run } from "./cli.js"
import { rewardsHistory } from "./lib/rewards.js"
import { BLOCK, STAKER, fakeContext, fakeRuntime, type FakeOptions } from "./test-support.js"

// `rewards history`'s periods, against the fake chain and the fake Mainnet subgraph in
// test-support.ts: two periods, a claim of 6 SAFE in the first and of 4 SAFE in the second.

const SAFE = 10n ** 18n

async function history(options: FakeOptions = {}, ...extra: string[]) {
  const rt = fakeRuntime(options)
  const code = await run(["rewards", "history", STAKER, ...extra], rt)
  return { code, out: rt.stdout(), err: rt.stderr() }
}

interface Periods {
  subgraph: { block: string; stale: boolean; source: string }
  allMatch: boolean
  periods: {
    period: number; endBlock: string; current: boolean; claims: number; claimed: string
    cumulativeAtEnd: { subgraph: string; chain: string; match: boolean }
  }[]
}

test("each period gives this address's claims in it, and its cumulative claimed by the subgraph and the chain at its last block", async () => {
  const r = await history({}, "--json")
  assert.equal(r.code, 0, r.err)
  const h = JSON.parse(r.out) as { periods: Periods; periodsReason: null }
  assert.equal(h.periodsReason, null)
  assert.equal(h.periods.subgraph.block, String(BLOCK))
  assert.equal(h.periods.allMatch, true)
  assert.match(h.periods.subgraph.source, /approximate block-window claim attribution/)
  assert.deepEqual(h.periods.periods.map((p) => ({ ...p, root: undefined, setAt: undefined })), [
    {
      period: 1, root: undefined, setAt: undefined, endBlock: String(BLOCK - 5n), current: false, claims: 1, claimed: String(6n * SAFE),
      cumulativeAtEnd: { subgraph: String(6n * SAFE), chain: String(6n * SAFE), match: true },
    },
    {
      period: 2, root: undefined, setAt: undefined, endBlock: String(BLOCK), current: true, claims: 1, claimed: String(4n * SAFE),
      cumulativeAtEnd: { subgraph: String(10n * SAFE), chain: String(10n * SAFE), match: true },
    },
  ])
})

test("the chain is read at each period's last block, not at the head", async () => {
  // At the head the chain says 10 SAFE. Period 1 ended at 6: a read at the head would differ.
  const r = await history({}, "--json")
  const first = (JSON.parse(r.out) as { periods: Periods }).periods.periods[0]!
  assert.equal(first.cumulativeAtEnd.chain, String(6n * SAFE))
})

test("reversed same-block claims use the final cumulative amount regardless of query tie order", async () => {
  // Both claims surround a root update in one block. Block ordering may return 10 before 6.
  const r = await history({ subgraph: "same-block-reversed" }, "--json")
  assert.equal(r.code, 0, r.err)
  const h = JSON.parse(r.out) as { periods: Periods; sumMatchesChain: boolean }
  assert.equal(h.sumMatchesChain, true)
  assert.equal(h.periods.allMatch, true)
  assert.deepEqual(h.periods.periods.map((p) => p.cumulativeAtEnd), [
    { subgraph: "0", chain: "0", match: true },
    { subgraph: String(10n * SAFE), chain: String(10n * SAFE), match: true },
  ])
  // Block windows place both claims in the new period, without resolving event order.
  assert.deepEqual(h.periods.periods.map((p) => [p.claims, p.claimed]), [[0, "0"], [2, String(10n * SAFE)]])
})

test("the text shows a row per period, newest first, and says every period matched", async () => {
  const r = await history()
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\nPeriods, from the subgraph at block 26,000,000 \(/)
  const rows = r.out.split("\n").filter((l) => /^ +[12] {2}/.test(l))
  assert.equal(rows.length, 2)
  assert.match(rows[0]!, /^ +2 .*26,000,000 \(current\) +1 +4 SAFE +10 SAFE +10 SAFE +match$/)
  assert.match(rows[1]!, /^ +1 .*25,999,995 +1 +6 SAFE +6 SAFE +6 SAFE +match$/)
  assert.match(r.out, /Every period: the subgraph's cumulative claimed equals MerkleDrop\.cumulativeClaimed\(address\) on chain at the period's last block\./)
  assert.match(r.out, /CLAIMS and CLAIMED use approximate block windows\./)
})

test("a subgraph that differs from the chain at the same block is flagged, in the period and overall", async () => {
  const json = await history({ subgraph: "differs" }, "--json")
  const p = (JSON.parse(json.out) as { periods: Periods }).periods
  assert.equal(p.allMatch, false)
  assert.deepEqual(p.periods[1]!.cumulativeAtEnd, { subgraph: String(9n * SAFE), chain: String(10n * SAFE), match: false })
  const text = await history({ subgraph: "differs" })
  assert.match(text.out, /DIFFERS/)
  assert.match(text.out, /Check failed for period 2: the subgraph and the chain differ at the same block\./)
})

test("a subgraph that cannot answer leaves the claims, read from the chain, and says why there are no periods", async () => {
  const json = await history({ subgraph: "down" }, "--json")
  assert.equal(json.code, 0, json.err)
  const h = JSON.parse(json.out) as { periods: null; periodsReason: string; count: number; sumMatchesChain: boolean }
  assert.equal(h.periods, null)
  assert.equal(h.periodsReason, "the subgraph could not give the periods (the subgraph answered HTTP 502)")
  assert.equal(h.count, 2)
  assert.equal(h.sumMatchesChain, true)
  const text = await history({ subgraph: "down" })
  assert.match(text.out, /Periods: not shown, because the subgraph could not give the periods \(the subgraph answered HTTP 502\)\.$/m)
})

test("empty indexed periods remain unavailable while CLI preserves verified chain claims", async () => {
  const json = await history({ subgraph: "empty" }, "--json")
  assert.equal(json.code, 0, json.err)
  const h = JSON.parse(json.out)
  assert.equal(h.periods, null)
  assert.match(h.periodsReason, /no reward periods/)
  assert.equal(h.count, 2)
  assert.equal(h.sumMatchesChain, true)
  const text = await history({ subgraph: "empty" })
  assert.match(text.out, /Periods: not shown, because .*no reward periods/)
  assert.doesNotMatch(text.out, /Every period:/)
})

test("incomplete claims and missing or duplicate periods never report a verified period history", async () => {
  for (const subgraph of ["missing-claim", "missing-period", "missing-last-period", "duplicate-period"] as const) {
    const json = await history({ subgraph }, "--json")
    assert.equal(json.code, 0, json.err)
    const h = JSON.parse(json.out)
    assert.equal(h.periods, null, subgraph)
    assert.match(h.periodsReason, /incomplete or inconsistent reward (claims|periods)/)
    assert.equal(h.count, 2)
    assert.equal(h.totalClaimed, String(10n * SAFE))
    assert.equal(h.sumMatchesChain, true)
    const text = await history({ subgraph })
    assert.match(text.out, /Periods: not shown, because .*incomplete or inconsistent/)
    assert.doesNotMatch(text.out, /Every period:/)
  }
})

test("same-block root updates cannot produce a verified period ending before it starts", async () => {
  const json = await history({ subgraph: "same-block-periods" }, "--json")
  assert.equal(json.code, 0, json.err)
  const h = JSON.parse(json.out)
  assert.equal(h.periods, null)
  assert.match(h.periodsReason, /inconsistent reward period boundaries/)
  assert.equal(h.count, 2)
  assert.equal(h.sumMatchesChain, true)
  const text = await history({ subgraph: "same-block-periods" })
  assert.match(text.out, /Periods: not shown, because .*inconsistent reward period boundaries/)
  assert.doesNotMatch(text.out, /Every period:/)
})

test("SUBGRAPH_URL_MAINNET replaces core's endpoint, and its URL is never printed", async () => {
  const url = "https://user:key@subgraph.invalid/query"
  const r = await history({ env: { SUBGRAPH_URL_MAINNET: url } }, "--json")
  assert.equal(r.code, 0, r.err)
  const h = JSON.parse(r.out) as { periodsReason: string }
  // The fake answers 404 for any URL it does not know, so the override was the one asked.
  assert.equal(h.periodsReason, "the subgraph could not give the periods (the subgraph answered HTTP 404)")
  assert.doesNotMatch(r.out + r.err, /subgraph\.invalid|user:key/)
})

test("invalid subgraph settings never reach fetch or escape through CLI text or JSON", async () => {
  for (const url of [
    "not-a-url-private-marker",
    "https://user:private-marker@[broken/query",
    "ftp://user:private-marker@subgraph.invalid/query",
    "data:text/plain,private-marker",
  ]) {
    for (const flags of [[], ["--json"]]) {
      const rt = fakeRuntime({ env: { SUBGRAPH_URL_MAINNET: url } })
      let fetches = 0
      const code = await run(["rewards", "history", STAKER, ...flags], {
        ...rt,
        createContext: (options) => ({
          ...rt.createContext(options),
          fetch: (...args) => { fetches++; return globalThis.fetch(...args) },
        }),
      })
      assert.equal(code, 0)
      assert.equal(fetches, 0)
      assert.doesNotMatch(rt.stdout() + rt.stderr(), /private-marker|subgraph\.invalid/)
      assert.match(rt.stdout(), /SUBGRAPH_URL_MAINNET must be an HTTP or HTTPS URL/)
      if (flags.length) {
        const h = JSON.parse(rt.stdout())
        assert.equal(h.periods, null)
        assert.equal(h.count, 2)
        assert.equal(h.sumMatchesChain, true)
      }
    }
  }
})

test("mixed-case HTTP settings are normalized and redacted when fetch repeats the endpoint", async () => {
  const rt = fakeRuntime({ env: { SUBGRAPH_URL_MAINNET: "HTTPS://user:private-marker@subgraph.invalid/query" } })
  let requested = ""
  assert.equal(await run(["rewards", "history", STAKER, "--json"], {
    ...rt,
    createContext: (options) => ({
      ...rt.createContext(options),
      fetch: async (input) => { requested = String(input); throw new Error(`Request failed: ${requested}`) },
    }),
  }), 0)
  assert.equal(requested, "https://user:private-marker@subgraph.invalid/query")
  assert.doesNotMatch(rt.stdout() + rt.stderr(), /private-marker|subgraph\.invalid/)
  assert.equal(JSON.parse(rt.stdout()).periodsReason, "the subgraph could not give the periods (Request failed: <url>)")
})

test("period and account queries share the indexed block, while a full page stays unknown rather than partial", async () => {
  const ctx = fakeContext()
  const queries: string[] = []
  const full = await rewardsHistory({
    ...ctx,
    fetch: async (input, init) => {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query
      queries.push(query)
      const response = await ctx.fetch(input, init)
      if (query.includes("_meta")) return response
      const body = await response.json() as { data: { rewardClaims: unknown[] } }
      body.data.rewardClaims = Array.from({ length: 1000 }, () => body.data.rewardClaims[0])
      return Response.json(body)
    },
  }, STAKER)
  assert.equal(queries.length, 2)
  assert.equal(queries[1]!.match(new RegExp(`block: \\{ number: ${BLOCK} \\}`, "g"))?.length, 3)
  assert.ok(queries[1]!.includes(`account: "${STAKER.toLowerCase()}"`))
  assert.equal(full.periods, null)
  assert.match(full.periodsReason!, /1000 or more rows/)
  assert.equal(full.count, 2)
  assert.equal(full.sumMatchesChain, true)
})


test("GraphQL provider errors remain fixed and private in CLI output", async () => {
  for (const flags of [[], ["--json"]]) {
    const result = await history({ subgraph: "graphql-error" }, ...flags)
    assert.equal(result.code, 0)
    assert.match(result.out, /the subgraph answered with an error/)
    assert.doesNotMatch(result.out + result.err, /private-provider-marker/)
    if (flags.length) {
      assert.equal(JSON.parse(result.out).periods, null)
      assert.equal(JSON.parse(result.out).count, 2)
    }
  }
})

test("GRAPH_API_KEY reaches the gateway without leaking into history output; URL override wins", async () => {
  for (const override of [undefined, "https://override.test/query"]) {
    const rt = fakeRuntime({ env: { GRAPH_API_KEY: "test-only-private-marker", ...(override ? { SUBGRAPH_URL_MAINNET: override } : {}) } })
    const create = rt.createContext
    let endpoint: string | undefined
    assert.equal(await run(["rewards", "history", STAKER, "--json"], {
      ...rt, createContext: (options) => { endpoint = options.subgraphUrl; return create(options) },
    }), 0)
    assert.equal(endpoint, override ?? "https://gateway.thegraph.com/api/test-only-private-marker/subgraphs/id/K1gHS5P5vZU3LApqchuuQxkmZGDDAUavkQUdGDV7Vxs")
    assert.doesNotMatch(rt.stdout() + rt.stderr(), /test-only-private-marker|gateway\.thegraph/)
  }
})

test("CLI history recovers from gateway failure and reports unavailable if Studio also fails", async () => {
  for (const bothFail of [false, true]) {
    const rt = fakeRuntime({ env: { GRAPH_API_KEY: "test-only-private-marker" }, ...(bothFail ? { subgraph: "down" as const } : {}) })
    const code = await run(["rewards", "history", STAKER, "--json"], rt)
    assert.equal(code, 0)
    const result = JSON.parse(rt.stdout())
    if (bothFail) {
      assert.equal(result.periods, null)
      assert.match(result.periodsReason, /gateway and Studio fallback both failed/)
    } else {
      assert.equal(result.periods.allMatch, true)
    }
    assert.doesNotMatch(rt.stdout() + rt.stderr(), /test-only-private-marker/)
  }
})
