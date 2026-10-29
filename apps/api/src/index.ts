import { Hono } from "hono"
import { cors } from "hono/cors"
import { ApiError, type Fetcher, type Result } from "./upstream.js"
import { address, ensLookup, findValidator, validators, type EnsLookup } from "./validators.js"
import { decodeCursor, detail, events, history, stats } from "./subgraphs.js"

export interface Dependencies {
  fetch?: Fetcher
  ens?: EnsLookup
  now?: () => number
  cache?: Pick<Cache, "match" | "put">
}
export function createApp(dependencies: Dependencies = {}) {
  const app = new Hono<{ Bindings: Env }>()
  const fetcher = dependencies.fetch ?? fetch
  const lookup = dependencies.ens ?? ensLookup(fetcher)
  const now = dependencies.now ?? Date.now
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], exposeHeaders: ["X-Data-Sources", "X-Cache", "X-Data-Expires-At"] }))
  app.onError((error, c) => {
    const safe = error instanceof ApiError ? error : new ApiError("internal_error", 500, "The API could not complete this request.")
    // Never log upstream errors: RPC and subgraph URLs may contain credentials.
    console.error(JSON.stringify({ event: "api_error", code: safe.code, status: safe.status }))
    c.header("Cache-Control", "no-store")
    return c.json({ error: { code: safe.code, message: safe.message } }, safe.status)
  })
  app.notFound(c => c.json({ error: { code: "not_found", message: "Endpoint not found." } }, 404))
  app.get("/v1/*", async c => {
    const start = now(), url = new URL(c.req.url)
    const path = url.pathname
    const match = /^\/v1\/validators\/([^/]+)(?:\/(history|events))?$/.exec(path)
    if (path !== "/v1/validators" && path !== "/v1/health" && path !== "/v1/system/stats" && !match) {
      return c.notFound()
    }
    // Validate before a cache lookup; unknown parameters cannot create cache-busting variants.
    const operation = match?.[2]
    const allowed = operation === "history" ? ["window"] : operation === "events" ? ["cursor"] : []
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new ApiError("invalid_query", 400, "The query contains an unsupported or duplicate parameter.")
    }
    const window = url.searchParams.get("window") ?? "7d"
    if (operation === "history" && window !== "7d" && window !== "30d" && window !== "all") {
      throw new ApiError("invalid_window", 400, "Use window=7d, 30d, or all.")
    }
    const target = match ? address(match[1]!) : undefined
    const cursor = target && operation === "events" ? decodeCursor(url.searchParams.get("cursor") ?? undefined, target) : undefined
    const cache = dependencies.cache ?? (typeof caches === "undefined" ? undefined : caches.default)
    // A shared metadata snapshot avoids one GitHub/ENS refresh per validator route.
    // Cache API entries remain local to this POP and never outlive publication freshness.
    const readValidators = async () => {
      const sourceKey = new Request(new URL("/__internal/validator-metadata", url.origin))
      const cached = await cache?.match(sourceKey)
      if (cached && Number(cached.headers.get("X-Data-Expires-At")) > start) {
        return await cached.json() as Awaited<ReturnType<typeof validators>>
      }
      const fresh = await validators(fetcher, lookup, start)
      const expiry = Math.min(fresh.expiresAt, start + 300_000)
      if (cache && expiry > now()) {
        await cache.put(sourceKey, new Response(JSON.stringify(fresh), { headers: {
          "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.floor((expiry - now()) / 1000)}`,
          "X-Data-Expires-At": String(expiry),
        } })).catch(() => { console.error(JSON.stringify({ event: "cache_write_failed" })) })
      }
      return fresh
    }
    const readStats = async () => {
      const sourceKey = new Request(new URL("/__internal/system-stats", url.origin))
      const cached = await cache?.match(sourceKey)
      if (cached && Number(cached.headers.get("X-Data-Expires-At")) > start) {
        return await cached.json() as Awaited<ReturnType<typeof stats>>
      }
      const fresh = await stats(fetcher, c.env, start)
      const expiry = Math.min(fresh.expiresAt, start + 60_000)
      if (cache && expiry > now()) {
        await cache.put(sourceKey, new Response(JSON.stringify(fresh), { headers: {
          "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.floor((expiry - now()) / 1000)}`,
          "X-Data-Expires-At": String(expiry),
        } })).catch(() => { console.error(JSON.stringify({ event: "cache_write_failed" })) })
      }
      return fresh
    }
    const cacheable = path !== "/v1/health"
    if (target) url.pathname = path.replace(match![1]!, target.toLowerCase())
    url.searchParams.sort()
    const key = new Request(url.toString())
    if (cacheable && cache) {
      const cached = await cache.match(key)
      if (cached && Number(cached.headers.get("X-Data-Expires-At")) > start) {
        const response = new Response(cached.body, cached)
        response.headers.set("X-Cache", "HIT")
        return response
      }
    }
    let result: Result<unknown>
    if (path === "/v1/health") {
      const checks = await Promise.allSettled([readValidators(), readStats()])
      const sources = checks.flatMap(r => r.status === "fulfilled" ? r.value.sources : [])
      const failures = checks.flatMap((r, i) => r.status === "rejected" ? [{ dependency: i === 0 ? "sef" : "subgraphs", code: r.reason instanceof ApiError ? r.reason.code : "upstream_failed" }] : [])
      c.header("Cache-Control", "no-store")
      return c.json({ status: failures.length ? "degraded" : "ok", checkedAt: new Date(start).toISOString(), sources, failures }, failures.length ? 503 : 200)
    } else if (path === "/v1/system/stats") {
      result = await readStats()
    } else {
      const list = await readValidators()
      if (!target) result = list
      else {
        const info = findValidator(list.data, target)
        const enriched = operation === "history" ? await history(fetcher, c.env, target, window as "7d" | "30d" | "all", start)
          : operation === "events" ? await events(fetcher, c.env, target, cursor, start)
          : await detail(fetcher, c.env, target, start)
        result = { data: operation ? enriched.data : { ...info, ...enriched.data }, sources: [...list.sources, ...enriched.sources],
          expiresAt: Math.min(list.expiresAt, enriched.expiresAt) }
      }
    }
    const expires = Math.min(result.expiresAt, start + 60_000)
    if (expires <= now()) throw new ApiError("stale_upstream", 503, "The data expired while the request was running.")
    const headers = new Headers({ "Content-Type": "application/json; charset=UTF-8", "Cache-Control": `public, max-age=${Math.max(0, Math.floor((expires - now()) / 1000))}`,
      "X-Data-Expires-At": String(expires), "X-Data-Sources": JSON.stringify(result.sources), "X-Cache": "MISS" })
    // Keep the validator list a bare array for the unchanged reference frontend.
    const response = new Response(JSON.stringify(target || path === "/v1/system/stats" ? { ...result.data as object, sources: result.sources } : result.data), { headers })
    if (cache) {
      const write = cache.put(key, response.clone()).catch(() => { console.error(JSON.stringify({ event: "cache_write_failed" })) })
      try { c.executionCtx.waitUntil(write) } catch { await write }
    }
    console.log(JSON.stringify({ event: "api_response", route: target ? `validator/${operation ?? "detail"}` : path, durationMs: now() - start }))
    return response
  })
  return app
}
export default createApp()
