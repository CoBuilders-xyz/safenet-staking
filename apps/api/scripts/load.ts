export {}
/** HTTP latency only. A cache MISS does not prove a cold Worker isolate. */
const base = process.env.API_URL
if (!base) throw new Error("Set API_URL to the Worker origin.")
const count = Number(process.env.LOAD_REQUESTS ?? 100), concurrency = Number(process.env.LOAD_CONCURRENCY ?? 5)
if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("Invalid load bounds")
const path = process.env.LOAD_PATH ?? "/v1/validators"
const target = new URL(path, base)
if (target.origin !== new URL(base).origin) throw new Error("LOAD_PATH must stay on API_URL's origin")
const samples: { ms: number; status: number; cache: string }[] = []
async function request() {
  const start = performance.now()
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(30000) })
    await r.arrayBuffer()
    samples.push({ ms: performance.now() - start, status: r.status, cache: r.headers.get("X-Cache") ?? "UNKNOWN" })
  } catch { samples.push({ ms: performance.now() - start, status: 0, cache: "UNKNOWN" }) }
}
// Record the first request separately; do not hide warming cost from the sample set.
await request()
let next = 1
await Promise.all(Array.from({ length: concurrency }, async () => { while (next++ < count) await request() }))
function summarize(rows: typeof samples) {
  const sorted = rows.map(s => s.ms).sort((a, b) => a - b)
  return { count: rows.length, errors: rows.filter(s => s.status !== 200).length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    maxMs: sorted.at(-1) ?? null }
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), environment: target.hostname, path: target.pathname, concurrency,
  firstRequest: samples[0], all: summarize(samples), cacheHit: summarize(samples.filter(s => s.cache === "HIT")),
  cacheMiss: summarize(samples.filter(s => s.cache === "MISS")), samples,
  limitations: "Client wall-clock HTTP measurements. Cache MISS is not a cold isolate. Loopback runs do not prove deployed latency. Errors are included, never counted as successful responses." }, null, 2))
if (samples.some(s => s.status !== 200)) process.exitCode = 1
