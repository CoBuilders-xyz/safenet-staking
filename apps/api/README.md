# Safenet API

Hono on Cloudflare Workers. The API exposes SEF metadata and the indexed Mainnet/Aegis data.
All chain constants and default upstream locations come from `packages/core`.

Validator detail keeps `registeredAtTimestamp` null until a registration is indexed.
`firstSeenAtTimestamp` is always present and describes the first indexed observation.
Clients can use it as a fallback date labelled "First seen", not "Registered".

## Run and verify

Use the Node version in `.nvmrc`. The cf CLI requires Node 22.18 or later.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @cobuilders/safenet-api dev
API_URL=http://127.0.0.1:8797 pnpm --filter @cobuilders/safenet-api smoke
API_URL=http://127.0.0.1:8797 LOAD_REQUESTS=101 LOAD_CONCURRENCY=5 pnpm --filter @cobuilders/safenet-api load
pnpm --filter @cobuilders/safenet-api test
pnpm --filter @cobuilders/safenet-api build
pnpm check
```

Set `API_PORT` to another unused loopback port when necessary. Never restart the manual QA fork.
`cf workers types` generates runtime types from the compatibility date and actual configuration.
The build writes `.cloudflare/output/v0/`. It does not upload or deploy.
Logs and traces are enabled. Query strings and upstream exceptions are excluded from application logs.

## Endpoints

| GET | Result |
| --- | --- |
| `/v1/validators` | Bare array compatible with the reference `useValidators` hook |
| `/v1/validators/:address` | Metadata plus exact Mainnet stake, registration and delegator counts |
| `/v1/validators/:address/history?window=7d` | Current programme participation by completed UTC day; `7d`, `30d`, `all` |
| `/v1/validators/:address/events` | Mainnet stakes and withdrawals, including claim state and transaction references |
| `/v1/system/stats` | Exact Mainnet totals and programme-specific Gnosis counters |
| `/v1/health` | Dependency readiness, provenance and structured failures; HTTP 503 when degraded |

Addresses are case-insensitive. Invalid input is 400. An address absent from SEF is 404.
Upstream failures or malformed data are 502; timeout is 504. Stale, indexing-error,
unindexed or unconfirmed-programme data is 503. Errors carry `{error: {code, message}}`.
Upstream error text is never exposed. GET responses permit cross-origin browser reads.

The list preserves `address`, `label`, `commission`, `is_active`, and
`participation_rate_14d`. Commission and participation are fractions. Null participation stays
null. The reference UI converts this wire format into camelCase fields and percentages.
Returning the hook's camelCase shape directly would break its conversion.

Labels use Mainnet ENS reverse lookup with forward confirmation. An unresolved or failed lookup
returns `""`. Metadata reports how many lookups failed. SEF's manual names never become labels.
`is_active` remains SEF's published flag. `registered` is the separate indexed Mainnet fact.
An empty label produces an empty name heading in the existing reference card; its address button
still identifies the validator. This is the required empty-label contract, not an inferred name.

Amounts and event counters use decimal strings. The API never rounds wei through JavaScript numbers.
Stats name `proposals` explicitly; they do not claim this equals SEF's Aegis SentinelOracle request metric.

History uses SEF validator addresses as signing addresses. The Gnosis `staker` field identifies
another owner and is not substituted. Membership absent from current-programme consensus yields
`participation_unconfirmed`, including Beta-only validators. Queries filter every row by programme.
They end before the current indexed UTC day. `since`, `until`, and `coverageStartsAt` disclose bounds.
`all` covers the indexed current programme, not a mixture of programmes. Days without ceremonies
have null participation. Missing validator rows with a nonzero network denominator mean zero attendance.
The network ceremony count is the denominator, matching SEF's documented calculation.

History pages contain at most 500 days. All pages use one indexed block hash. Excessive histories
fail explicitly instead of returning a partial success. Event pages contain at most 100 stakes and
100 withdrawals. They sort by entity ID within each collection. Follow `nextCursor` until null.
Withdrawal rows describe initiation and later claim; they are not a flattened transaction timeline.
Cursors bind the address, both collection positions and indexed block hash. An expired snapshot must
be restarted. The current schema does not retain a separate validator-registration event timeline.

## Provenance, freshness and caching

`X-Data-Sources` records the pinned SEF commit/publication window or indexed block/hash/time.
Detail, history, events and stats also include `sources` in their body. The list stays a bare array.
`X-Data-Expires-At` is milliseconds since Unix epoch. `X-Cache` reports response cache HIT or MISS.

SEF data is fetched at its latest file commit, never paired with a moving branch timestamp.
It becomes unavailable after core's nine-hour threshold. Subgraph data must have an error-free
indexed block within core's fifteen-minute threshold. Unknown time is not fresh.

Response caching lasts at most 60 seconds and never exceeds source freshness. Shared SEF/ENS
metadata caching lasts at most five minutes per Cloudflare location, also bounded by freshness.
Health responses and errors are not cached. Health uses the bounded metadata cache and shares
successful subgraph stats with `/v1/system/stats` for at most 60 seconds, within source freshness.
Dependency readiness can therefore lag a new outage by up to 60 seconds. After expiry, failed
reads return degraded health; an old success is never served beyond its expiry.
The Cache API is local to each Cloudflare location; this is not a global quota limiter.
Set the `GITHUB_TOKEN` Worker secret for authenticated GitHub commit metadata requests.
Without it, GitHub permits only 60 unauthenticated requests per hour per source IP.
Authenticated quotas and Studio quotas remain deployment capacity dependencies.
Before public deployment, configure edge rate limits for health and data routes. Successful-data
caching does not limit uncached failed requests or concurrent cache misses during an outage.
No stale-on-error fallback fabricates healthy data.

## Reference compatibility

Reference source inspected: `safe-fndn/safenet-staking-ui` commit
`225122a8d32309de3fec9481f0ae4ba4054212bb`.
Fetch that archive into a temporary directory, install its dependencies without lifecycle scripts,
and run its unmodified Vite app on a separate loopback port:

```sh
VITE_VALIDATOR_INFO_URL=http://127.0.0.1:8797/v1/validators pnpm --dir "$REFERENCE_DIR" exec vite --host 127.0.0.1 --port 8798 --strictPort
API_URL=http://127.0.0.1:8797 REFERENCE_URL=http://127.0.0.1:8798 pnpm --filter @cobuilders/safenet-api test:reference
```

The script uses Chromium. It verifies the actual API response, address cards, activity badges,
commissions, participation and absence of page errors. It writes a screenshot under `/tmp`.
It does not mock geography, RPC or validator responses. The reference's normal access checks must pass.
An API fixture test or copied hook alone is insufficient evidence for this command.

## Load evidence

`load` records every HTTP request, including failures. It reports nearest-rank p50/p95 and maximum,
separately for cache hits and misses. `LOAD_PATH` selects another endpoint. Default concurrency is 5.
`LOAD_REQUESTS` defaults to 100 and includes the initial request. Output contains the host and path,
not URL credentials or query parameters. Use a public, credential-free API origin.

A cache miss is not a cold Worker isolate. Loopback measurements do not establish deployed latency.
For release evidence, run against the deployed origin from the intended client regions. Record
revision, region, sample count, concurrency, duration, cache state and errors. Measure fresh-isolate
requests separately using an approved newly deployed version and platform traces. A lone initial
request does not establish cold p95. Targets remain warm p95 <800 ms and cold p95 <1500 ms.

## Publication handoff

No infrastructure is created by tests or builds. The parent owns publication and release approval.
Before publication, select the account and public Worker hostname, establish production subgraph
capacity, and verify Worker upload permissions. Current defaults are rate-limited Studio endpoints.
Set public endpoint configuration in `cloudflare.config.ts`; keep authenticated endpoints or keys
in Worker secrets if the selected provider requires them. Never put a credential in a text binding
or frontend `VITE_` value. `GITHUB_TOKEN` is declared with `bindings.secret()` and is sent
only to GitHub's commits API, never to raw assets, subgraphs or RPC endpoints.
Augusto must set this secret on the `safenet-api` Worker through its Cloudflare dashboard
(Settings → Variables and Secrets → Add → Secret), before public deployment. Use a token
with only the read access needed for the public SEF repository. For local development,
set it in ignored `apps/api/.dev.vars`; never commit the value. Local fixtures need no token.
No storage bindings are required: the implementation uses the Cache API.

After approval, build and inspect `cf deploy --dry-run --prebuilt --mode production` from `apps/api`.
Publish that exact reviewed output with `cf deploy --prebuilt --mode production`. Then run smoke,
reference rendering and load against the published origin. Check actual logs and traces.
Local success does not satisfy the issue's requirement that all six endpoints be live.
