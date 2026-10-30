# Safenet alerts

This Worker authenticates a wallet signature and stores opt-in subscriptions in Supabase.
It creates no user accounts, holds no funds and sends no transactions.
The web route is `/#/alerts`, consistent with the application's hash routing.

## Local validation

From the repository root:

Use the root `.nvmrc` (Node 22.23.4). The Cloudflare config loader requires Node 22.18 or later.

```sh
pnpm --filter @cobuilders/safenet-alerts check
pnpm --filter @cobuilders/safenet-alerts test
pnpm --filter @cobuilders/safenet-alerts test:runtime
E2E_PORT=5296 pnpm --filter @cobuilders/safenet-web test:e2e alerts.spec.ts --workers=1
pnpm check
```

`test` executes the migration in embedded PostgreSQL. It verifies real EOA signatures,
atomic nonce consumption, expiry, wallet isolation, role restrictions, notification deduplication,
private Telegram linking, chronological misses and Web Push payload decryption.
`test` also runs `test:runtime`, which builds with `cf` and runs the artifact in workerd, with isolated mock providers.
The web E2E tests mock the alert API and wallet. These tests do **not** prove real delivery,
real Safe threshold signing, a Supabase deployment, or fork-triggered acceptance.

The local CLI is a package dependency. `pnpm --filter @cobuilders/safenet-alerts dev` binds
loopback port 8796. It uses only this checkout's configuration. Never reuse or reset the manual
QA fork for alert testing. The `cf` config disables workers.dev and preview URLs; no public
route is created by this change. No migration or deployment runs automatically.

## Provisioning contract

The release owner must select an approved Supabase project and Worker endpoint before deployment.
Apply `migrations/001_alerts.sql`, then `002_ceremony_archive.sql`, with the project's migration role.
Stop the old Worker before migration and start the updated Worker afterward.
Migration 002 atomically moves existing unmatched JSON entries into the SID archive.
It retains blocked attestations and membership snapshots, invalidates the old lease, and rejects legacy checkpoint writes.
A migration failure rolls back all changes; do not start the updated Worker until migration succeeds.
Do not apply these migrations to an unrelated project. All tables have RLS enabled and no browser policies. Only the Worker receives the service
role key. Supabase Auth is not used.

Configure Worker bindings using the secret delivery mechanism. Do not put secret values in commands,
source files, logs or browser variables:

| Binding | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin, scheme and host, with no path or trailing slash. SIWE domain and CORS allowlist. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Project REST origin and backend service credential. |
| `MAINNET_RPC_URL`, `GNOSIS_RPC_URL` | Mainnet reads/contract-wallet verification and finalized Aegis history. Must answer the expected chain ID. |
| `SUBGRAPH_URL_MAINNET` | Production Mainnet subgraph endpoint; a Studio development endpoint cannot support sustained subscription volume. |
| `REWARDS_BASE_URL` | Optional isolated-fork dataset override. Normally resolve the canonical ENS dataset, with core's repository fallback. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` | A dedicated bot token and its username, without `@`. Do not reuse a bot consumed by another getUpdates poller or webhook. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Persistent matching VAPID keypair and valid `mailto:` or HTTPS contact. Keep the private key server-side. |

Set the web build's `VITE_ALERTS_API_URL` to the approved service origin. This is public and must
contain no credentials. Without it, the route explicitly reports that alerts are not configured.
The public VAPID key is returned by `/config`; the browser never receives provider credentials.
Supabase account access alone is insufficient: a project URL and service key are required.

## Authentication and ownership

The server creates a five-minute SIWE challenge for core's Mainnet chain and the configured app
origin. A signature is verified using viem's public client, including deployed ERC-1271 wallets.
Safe owners must satisfy the Safe's signature threshold; recovering one owner EOA is insufficient.
If verification fails while other owners approve, the UI retries the same signature and challenge.
An expired challenge requires a new signature; it never reuses a consumed nonce.
The database consumes each challenge atomically once. The signature hash binds subscriptions to
that verified session. Session bearer tokens are random, hashed in storage, expire after 30 minutes,
and stay only in browser memory. Disconnecting, changing wallets or leaving the route discards them.
Challenge creation is bounded to ten active challenges per wallet and 1,000 globally.
Each wallet can hold ten subscriptions. The server derives ownership from the session on every read
and mutation. The browser cannot supply a wallet owner for another wallet's subscription.

Telegram subscription creation returns a ten-minute, single-use bot link. Only `/start <token>` in
a private chat can bind the recipient. The browser never supplies a chat ID. A user who loses that
link deletes the unlinked subscription and creates another. The poller does not send to groups,
unlinked subscriptions or arbitrary recipients. Browser endpoint validation allows known HTTPS push
providers only and forbids credentials, ports and redirects.

Deleting a subscription removes its delivery token and event history through a foreign-key cascade.
Expired authentication records are cleaned each poll. Operational run records contain only counts.
The service worker caches only the API location, under its own deployment scope.

## Conditions and delivery semantics

Every five minutes, a single leased poller evaluates subscriptions. It reads finalized chain blocks,
checks their freshness and verifies chain IDs. Mainnet delegation discovery pages the subgraph at
one finalized block and verifies each positive stake and validator registration on chain.
Mainnet finalized blocks may trail by 13–19 minutes normally; a 30-minute age limit rejects stalled
finality. Subgraph freshness remains bounded separately. Withdrawal, reward and delegation source
failures mark the run unhealthy but do not discard verified conditions from independent sources.

* **Cooldown:** walk contract withdrawal IDs; alert for each positive amount past `claimableAt`.
* **Rewards:** resolve core's canonical dataset; verify the Merkle proof, current on-chain root and
  cumulative claimed amount. Missing, stale-root or invalid proofs cannot produce an alert.
* **Deregistered:** notify a delegator whose validator is no longer registered. The subgraph's
  `registeredAtBlock` distinguishes registration episodes without resending after stake activity.
* **Participation:** count attendance over up to 14 complete Aegis UTC days, ending at the latest
  complete day with an attested ceremony. Use core's complete-day boundary. Known members with no
  attendance count as zero. Notify below the user's percentage, at most once per complete-day check.
* **Consecutive misses:** scan Aegis events from core's deployment floor in finalized block/log order.
  Join each attestation to its completed signature and winning-root shares. Begin membership at the
  first programme event. A winning attendance resets the streak; losing-root shares and non-attestation
  signatures cannot reset it. Never infer a streak from cumulative absences. A missing completion
  blocks subsequent rounds until history is complete. Alert once per streak and user threshold.

Gnosis backfill commits at most ten batches per invocation, each spanning at most 2,000 blocks.
Dense ranges shrink until they contain at most 1,000 logs. Each batch commits its checkpoint atomically.
Recognized RPC result-size errors and aggregate archive-recovery limits also shrink the complete-block range.
The archive read returns a null capacity signal above 8 MiB, before changing any state.
Transport, authentication, lease and commit errors remain failures; the reader does not retry an uncertain commit.
No participation or streak alert is sent until it reaches the current finalized head. The previous
checkpoint hash must match; a finalized history mismatch fails closed for operator investigation.
No Gnosis schema change is needed. Existing Aegis frontend/subgraph semantics remain unchanged.
Unmatched ceremonies persist in `alerts_ceremonies`, keyed by SID, without age pruning or a total row cap.
Before folding a batch, the Worker recovers every referenced SID, including its winning shares.
Recovery returns an explicit entry for each SID; a missing entry or failed read blocks advancement and attendance alerts.
One transaction saves archive writes, archive deletes, and the checkpoint. Lease ownership and checkpoint
revision checks reject expired owners and concurrent stale writers. Earlier committed batches survive later failures.

Memory limits apply to each transfer: at most 1,000 SIDs, 64 KiB per archived ceremony, and 8 MiB
per recovery response, archive write payload, or checkpoint. SQL measures serialized JSON, including spacing,
so its byte checks can reject a payload slightly below the Worker's compact JSON limit.
The checkpoint retains at most 10,000 blocked attestations. Their original ordering and membership snapshots remain intact.
A single block above 1,000 logs, an oversized ceremony/checkpoint, or a blocked-attestation overflow fails closed.
These limits do not cap the number of unmatched ceremonies stored across batches.
Database storage grows with unmatched history; monitor storage and archive query latency before release.
There is no verified maximum attestation delay, so cleanup never deletes unmatched archive rows.

Delivery events have unique subscription/condition keys and a two-minute claim lease. Failures retry
on later polls. Provider acceptance stops automatic resends. A crash between sending and storing
acceptance can duplicate a message: providers do not offer an atomic transaction with Supabase.
Expired push endpoints and blocked bots disable that subscription until the user recreates it.
A provider success is **not** receipt confirmation. Browser confirmation follows `showNotification`;
Telegram confirmation requires the recipient's inline button. Receipt capabilities expire after 24 hours.

The Cron lease lasts 16 minutes, beyond the Worker's 15-minute execution limit.
A poll stops between subscriptions after ten minutes and saves its
position, so subsequent invocations continue rather than starving later subscriptions. Gnosis warmup,
RPC errors and delivery failures appear in aggregate run health. A subgraph/chain failure is not a
successful zero-result evaluation.
Telegram polling failures keep the run unhealthy but do not stop browser deliveries.
Use a Workers Paid plan. Free-plan CPU and subrequest limits cannot support this poller.
Validate backfill duration and subscription volume against the selected plan before release.

## Operations and twelve-month evidence

`GET /health` returns only `{ healthy: boolean }`. It returns 503 when the latest run failed,
is incomplete, or is over fifteen minutes old. Monitor it from the approved private operations path.
Investigate failed runs and missing five-minute slots. Do not interpret a healthy HTTP process as
proof of notifications. The release owner must assign monitoring, billing, renewal and incident ownership
for twelve months; this code does not provision those services.

`alerts_runs` retains thirteen months of aggregate status, evaluation, provider-acceptance and failure
counts. Use successful five-minute slots divided by all expected slots for the month-12 uptime report;
include missing slots as downtime. Export the report through an authenticated operational connection.
Run `pnpm --filter @cobuilders/safenet-alerts report:uptime <from-UTC-ISO> <until-UTC-ISO>` with the
existing service credential injected. It pages aggregate runs and reports missing slots as downtime.
The range must align to five-minute boundaries. It prints no subscription or credential data.
Do not export wallet rows, chat IDs or push endpoints as evidence. Review retention and provider costs monthly.

Worker logs contain aggregate counters only. Invocation logs are disabled. Trace support is enabled
with zero sampling because provider URL paths can include bot credentials. Do not enable URL traces
without a provider-aware redaction mechanism. No upstream response body or exception is logged.

## Real acceptance procedure

1. Use an approved isolated environment, an explicit test wallet, private Telegram recipient and test browser.
2. Apply the schema there and configure the dedicated bot, VAPID and providers.
3. Start a new isolated Anvil fork on unused ports. Leave the existing manual QA fork and its stake untouched.
4. Point only the isolated alert service at that fork and its matching proof/subgraph data.
5. Sign the wallet challenge, subscribe both channels, press Start in the private bot chat, and grant browser permission.
6. Trigger a real fork condition, such as a withdrawal becoming claimable. For finality-based reads, mine sufficient extra blocks.
7. Invoke Cron. Capture the condition's chain evidence, Telegram receipt confirmation and browser notification confirmation.
8. Invoke Cron again and prove no duplicate. Delete both test subscriptions and retain redacted evidence in Linear COB-587.

Real acceptance remains open until both actual deliveries occur. Mocks, an encrypted request,
a successful build and a bot API response alone do not satisfy this acceptance gate.
