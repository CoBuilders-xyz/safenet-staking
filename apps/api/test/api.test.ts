import assert from "node:assert/strict"
import { test } from "node:test"
import { SEF_DATA, SUBGRAPH_STALE_AFTER_SECONDS, GNOSIS_INDEXED_PROGRAMME } from "@cobuilders/safenet-core"
import { createApp } from "../src/index.js"
import { ENV, HASH, NOW, OTHER, TARGET, graphData, meta, raw, upstream, type FixtureOptions } from "./fixtures.js"

function app(options: FixtureOptions = {}) { return createApp({ fetch: upstream(options), ens: async () => null, now: () => NOW }) }
async function get(path: string, options: FixtureOptions = {}) { return app(options).request(`http://api.test/v1/${path}`, {}, ENV) }

test("reference wire contract: bare array, fractional rates, inactive and null preserved, labels ENS-only", async () => {
  const response = await get("validators")
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [{ ...raw, label: "" }])
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*")
  assert.match(response.headers.get("X-Data-Sources")!, /commit/)
})
test("ENS success replaces manual labels; failures use empty labels and disclose unavailable lookup", async () => {
  const resolved = createApp({ fetch: upstream(), ens: async () => "operator.eth", now: () => NOW })
  const r = await resolved.request("http://api.test/v1/validators", {}, ENV)
  assert.equal((await r.json() as typeof raw[])[0]!.label, "operator.eth")
  const failed = createApp({ fetch: upstream(), ens: async () => { throw Error("secret URL must not escape") }, now: () => NOW })
  const f = await failed.request("http://api.test/v1/validators", {}, ENV)
  assert.equal((await f.json() as typeof raw[])[0]!.label, "")
  assert.match(f.headers.get("X-Data-Sources")!, /"unavailable":1/)
})
test("all six endpoints return actual typed results with provenance", async () => {
  for (const path of ["validators", `validators/${TARGET}`, `validators/${TARGET}/history?window=7d`, `validators/${TARGET}/events`, "system/stats", "health"]) {
    const response = await get(path)
    assert.equal(response.status, 200, path + " " + await response.clone().text())
  }
  const r = await get(`validators/${TARGET}`)
  assert.equal((await r.json() as Record<string, unknown>).totalStaked, "900719925474099300000")
})
test("bad address, query, window and cursor fail before upstream fetches", async () => {
  let fetched = false
  const a = createApp({ fetch: async () => { fetched = true; throw Error() }, now: () => NOW })
  for (const path of ["validators/bad", "validators?bust=1", `validators/${TARGET}/history?window=1d`, `validators/${TARGET}/events?cursor=bad`, `validators/${TARGET}/history?window=7d&window=all`]) {
    assert.equal((await a.request(`http://api.test/v1/${path}`, {}, ENV)).status, 400)
  }
  assert.equal(fetched, false)
})
test("a valid unlisted validator is 404, and absent indexed state is unavailable", async () => {
  assert.equal((await get(`validators/${OTHER}`)).status, 404)
  assert.equal((await get(`validators/${TARGET}`, { graph: () => ({ validator: null }) })).status, 503)
})
test("stale publication, missing/null freshness, indexing errors and stale blocks fail closed", async () => {
  assert.equal((await get("validators", { publication: NOW - SEF_DATA.staleAfterMs - 1 })).status, 503)
  for (const value of [null, { ...meta, hasIndexingErrors: true }, { ...meta, block: { ...meta.block, timestamp: null } }, { ...meta, block: { ...meta.block, timestamp: NOW / 1000 - SUBGRAPH_STALE_AFTER_SECONDS - 1 } }]) {
    const r = await get(`validators/${TARGET}`, { graph: q => ({ ...graphData(q), _meta: value }) })
    assert.ok(r.status >= 500)
    assert.equal(r.headers.get("Cache-Control"), "no-store")
  }
})
test("malformed upstream values and duplicate validators cannot produce successful defaults", async () => {
  for (const rows of [[{ ...raw, commission: "0.05" }], [{ ...raw, is_active: null }], [{ ...raw, participation_rate_14d: 2 }], [raw, raw], []]) {
    assert.equal((await get("validators", { rows })).status, 502)
  }
})
test("history isolates Aegis, keeps null for no ceremonies, and uses signing addresses despite different owners", async () => {
  const r = await get(`validators/${TARGET}/history?window=7d`)
  const d = await r.json() as { programme: string; points: { participation: number | null }[]; signingAddress: string }
  assert.equal(d.programme, GNOSIS_INDEXED_PROGRAMME)
  assert.equal(d.signingAddress, TARGET.toLowerCase())
  assert.equal(d.points.length, 7)
  assert.equal(d.points[0]!.participation, null)
  assert.equal(d.points.at(-1)!.participation, 0.8)
  for (const window of ["30d", "all"]) assert.equal((await get(`validators/${TARGET}/history?window=${window}`)).status, 200)
})
test("Beta-only membership never becomes zero Aegis participation", async () => {
  const r = await get(`validators/${TARGET}/history`, { graph: q => q.includes("query Signers") ? { ...graphData(q), consensuses: [{ programme: GNOSIS_INDEXED_PROGRAMME, validators: [] }] } : graphData(q) })
  assert.equal(r.status, 503)
  assert.match(await r.text(), /participation_unconfirmed/)
})
test("history rejects crossed programmes, impossible attendance and changed snapshots", async () => {
  for (const patch of [{ programme: "beta", attended: "1" }, { programme: GNOSIS_INDEXED_PROGRAMME, attended: "11" }]) {
    const r = await get(`validators/${TARGET}/history`, { graph: q => q.includes("query History") ? { ...graphData(q), validatorDays: [{ date: Math.floor(NOW / 86400_000) * 86400 - 86400, ...patch }] } : graphData(q) })
    assert.equal(r.status, 502)
  }
  const r = await get(`validators/${TARGET}/history`, { graph: q => ({ ...graphData(q), ...(q.includes("query History") ? { _meta: { ...meta, block: { ...meta.block, hash: `0x${"f".repeat(64)}` } } } : {}) }) })
  assert.equal(r.status, 503)
})
test("event cursor is tied to the validator and indexed hash", async () => {
  const cursor = btoa(JSON.stringify({ address: TARGET.toLowerCase(), hash: HASH, stake: "s1", withdrawal: "w1" }))
  let checked = false
  const r = await get(`validators/${TARGET}/events?cursor=${encodeURIComponent(cursor)}`, { graph: (q, v) => {
    if (q.includes("query Events")) { assert.deepEqual(v.block, { hash: HASH }); assert.equal(v.stakeAfter, "s1"); checked = true }
    return graphData(q)
  } })
  assert.equal(r.status, 200)
  assert.equal(checked, true)
  assert.equal((await get(`validators/${OTHER}/events?cursor=${encodeURIComponent(cursor)}`)).status, 400)
})
test("cache expires at source freshness and never stores errors", async () => {
  const entries = new Map<string, Response>()
  let time = NOW
  const a = createApp({ fetch: upstream({ publication: NOW - SEF_DATA.staleAfterMs + 2000 }), ens: async () => null, now: () => time,
    cache: { match: async key => entries.get(String(key instanceof Request ? key.url : key))?.clone(), put: async (key, response) => { entries.set(String(key instanceof Request ? key.url : key), response) } } })
  const one = await a.request("http://api.test/v1/validators", {}, ENV)
  assert.equal(one.headers.get("X-Cache"), "MISS")
  const two = await a.request("http://api.test/v1/validators", {}, ENV)
  assert.equal(two.headers.get("X-Cache"), "HIT")
  time += 2001
  assert.equal((await a.request("http://api.test/v1/validators", {}, ENV)).status, 503)
})
test("health reports dependency degradation and stays uncached", async () => {
  const r = await get("health", { publication: NOW - SEF_DATA.staleAfterMs - 1 })
  assert.equal(r.status, 503)
  assert.equal(r.headers.get("Cache-Control"), "no-store")
  assert.match(await r.text(), /degraded/)
})
test("health and stats share bounded successful reads, then expose an outage after expiry", async () => {
  for (const first of ["health", "system/stats"]) {
    const entries = new Map<string, Response>()
    let time = NOW, queries = 0, offline = false
    const original = upstream()
    const a = createApp({ ens: async () => null, now: () => time,
      fetch: (async (url, init) => {
        if (init?.method === "POST") {
          queries++
          if (offline) throw new Error("upstream unavailable")
        }
        return original(url, init)
      }) as typeof fetch,
      cache: { match: async key => entries.get(String(key instanceof Request ? key.url : key))?.clone(),
        put: async (key, response) => { entries.set(String(key instanceof Request ? key.url : key), response) } } })
    assert.equal((await a.request(`http://api.test/v1/${first}`, {}, ENV)).status, 200)
    offline = true
    for (const route of ["health", "system/stats", "health"]) {
      const r = await a.request(`http://api.test/v1/${route}`, {}, ENV)
      assert.equal(r.status, 200)
      if (route === "health") assert.equal(r.headers.get("Cache-Control"), "no-store")
    }
    assert.equal(queries, 2)
    time += 60_001
    const degraded = await a.request("http://api.test/v1/health", {}, ENV)
    assert.equal(degraded.status, 503)
    assert.match(await degraded.text(), /degraded/)
    assert.equal(queries, 4)
    assert.equal((await a.request("http://api.test/v1/system/stats", {}, ENV)).status, 502)
  }
})
test("upstream exceptions are redacted and GraphQL errors cannot be mistaken for empty results", async () => {
  const a = createApp({ fetch: async () => { throw Error("https://secret.example/token") }, now: () => NOW })
  const r = await a.request("http://api.test/v1/validators", {}, ENV)
  assert.equal(r.status, 502)
  assert.doesNotMatch(await r.text(), /secret|token/)
})

test("events page preserves claimed withdrawals and resumes both collections without dropping rows", async () => {
  const stakes = Array.from({ length: 100 }, (_, i) => ({ id: `stake-${String(i).padStart(3, "0")}`, staker: OTHER, amount: "10", blockNumber: "10", timestamp: "100", transactionHash: HASH }))
  const withdrawals = [{ id: "1", staker: OTHER, amount: "20", claimed: true, initiatedAtBlock: "1", initiatedAtTimestamp: "10", initiatedTxHash: HASH, claimedAtBlock: "2", claimedAtTimestamp: "20", claimedTxHash: HASH }]
  const options: FixtureOptions = { graph: (q, v) => {
    if (!q.includes("query Events")) return graphData(q)
    return v.stakeAfter === "" ? { stakes, withdrawals } : { stakes: [{ ...stakes[0], id: "stake-100" }], withdrawals: [] }
  } }
  const r = await get(`validators/${TARGET}/events`, options)
  const first = await r.json() as { nextCursor: string; withdrawals: { claimed: boolean; claimedAtTimestamp: string }[] }
  assert.equal(first.withdrawals[0]!.claimedAtTimestamp, "20")
  const cursor = JSON.parse(atob(first.nextCursor)) as { stake: string; withdrawal: string }
  assert.equal(cursor.stake, "stake-099")
  assert.equal(cursor.withdrawal, "1")
  const next = await get(`validators/${TARGET}/events?cursor=${encodeURIComponent(first.nextCursor)}`, options)
  const second = await next.json() as { nextCursor: string | null; stakes: { id: string }[] }
  assert.equal(second.nextCursor, null)
  assert.equal(second.stakes[0]!.id, "stake-100")
})
test("GraphQL partial errors and timeout cannot pass health as successful data", async () => {
  const base = upstream()
  const a = createApp({ fetch: (async (input, init) => init?.method === "POST" ? Response.json({ data: graphData(String(init.body)), errors: [{ message: "private upstream info" }] }) : base(input, init)) as typeof fetch, ens: async () => null, now: () => NOW })
  const r = await a.request("http://api.test/v1/system/stats", {}, ENV)
  assert.equal(r.status, 502)
  assert.doesNotMatch(await r.text(), /private/)
  const b = createApp({ fetch: async () => { throw new DOMException("Timed out", "TimeoutError") }, now: () => NOW })
  assert.equal((await b.request("http://api.test/v1/validators", {}, ENV)).status, 504)
})
test("list metadata cache is shared across routes, and expired entries are not reused", async () => {
  const entries = new Map<string, Response>()
  let publications = 0, time = NOW
  const original = upstream()
  const a = createApp({ fetch: (async (url, init) => { if (String(url) === SEF_DATA.validatorInfoCommits) publications++; return original(url, init) }) as typeof fetch,
    ens: async () => null, now: () => time,
    cache: { match: async key => entries.get(String(key instanceof Request ? key.url : key))?.clone(), put: async (key, response) => { entries.set(String(key instanceof Request ? key.url : key), response) } } })
  await a.request("http://api.test/v1/validators", {}, ENV)
  await a.request(`http://api.test/v1/validators/${TARGET}/events`, {}, ENV)
  assert.equal(publications, 1)
  time += 300_001
  await a.request("http://api.test/v1/validators", {}, ENV)
  assert.equal(publications, 2)
})

test("all-history pagination reads beyond 500 days at one snapshot", async () => {
  const time = NOW + 600 * 86400_000
  const firstDay = Math.floor(NOW / 86400_000) * 86400 - 10 * 86400
  const rows = Array.from({ length: 600 }, (_, i) => ({ date: firstDay + i * 86400, programme: GNOSIS_INDEXED_PROGRAMME, attestationCeremonies: "10" }))
  let pages = 0
  const a = createApp({ now: () => time, ens: async () => null, fetch: upstream({ publication: time - 1000, graph: (q, v) => {
    const currentMeta = { ...meta, block: { ...meta.block, timestamp: time / 1000 - 20 } }
    if (!q.includes("query History")) return { ...graphData(q), _meta: currentMeta }
    assert.equal(v.hash, HASH)
    pages++
    const page = rows.filter(row => row.date > Number(v.after)).slice(0, 500)
    return { _meta: currentMeta, consensusDays: page, validatorDays: page.map(row => ({ date: row.date, programme: row.programme, attended: "7" })) }
  } }) })
  const r = await a.request(`http://api.test/v1/validators/${TARGET}/history?window=all`, {}, ENV)
  assert.equal(r.status, 200, await r.clone().text())
  const d = await r.json() as { points: { ceremonies: string; attended: string }[] }
  assert.equal(pages, 2)
  assert.equal(d.points.filter(point => point.ceremonies === "10").length, 600)
  assert.equal(d.points.filter(point => point.attended === "7").length, 600)
})

test("health never reuses SEF metadata beyond 60 seconds even when list routes prime the cache", async () => {
  for (const first of ["health", "validators"]) {
    const entries = new Map<string, Response>()
    let time = NOW, offline = false
    const original = upstream()
    const a = createApp({ ens: async () => null, now: () => time,
      fetch: (async (url, init) => {
        if (offline && String(url) === SEF_DATA.validatorInfoCommits) throw new Error("SEF unavailable")
        return original(url, init)
      }) as typeof fetch,
      cache: { match: async key => entries.get(String(key instanceof Request ? key.url : key))?.clone(),
        put: async (key, response) => { entries.set(String(key instanceof Request ? key.url : key), response) } } })
    assert.equal((await a.request(`http://api.test/v1/${first}`, {}, ENV)).status, 200)
    offline = true
    time = NOW + 59_999
    assert.equal((await a.request("http://api.test/v1/health", {}, ENV)).status, 200)
    for (const age of [60_000, 299_000]) {
      time = NOW + age
      const r = await a.request("http://api.test/v1/health", {}, ENV)
      assert.equal(r.status, 503)
      assert.equal(r.headers.get("Cache-Control"), "no-store")
      const body = await r.json() as { failures: { dependency: string }[] }
      assert.ok(body.failures.some(f => f.dependency === "sef"))
    }
  }
})
