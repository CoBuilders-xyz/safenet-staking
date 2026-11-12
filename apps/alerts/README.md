# Safenet alerts

This Worker authenticates a wallet signature and stores opt-in subscriptions in Cloudflare D1.
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

`test` applies the migrations to a fresh D1 database in workerd, through Miniflare, for each test.
No query is mocked. It verifies real EOA signatures,
atomic nonce consumption, expiry, wallet isolation, role restrictions, notification deduplication,
private Telegram linking, chronological misses and Web Push payload decryption.
`test` also runs `test:runtime`, which builds with `cf` and runs the artifact in workerd, with isolated mock providers.
The web E2E tests mock the alert API and wallet. These tests do **not** prove real delivery,
real Safe threshold signing, a deployed D1 database, or fork-triggered acceptance.

The local CLI is a package dependency. `pnpm --filter @cobuilders/safenet-alerts dev` binds
loopback port 8796. It uses only this checkout's configuration. Never reuse or reset the manual
QA fork for alert testing. The `cf` config disables workers.dev and preview URLs and declares no
route. The custom domain comes from Terraform in `infra/`. Migrations and deployment run only through
the manual workflow `.github/workflows/workers-deploy.yml`; `DEPLOY.md` at the root has the order.

## Provisioning contract

Terraform in `infra/` creates the D1 database `safenet-alerts`. The deploy workflow applies
`migrations/` with `cf d1 migrations apply`, which records each file in `d1_migrations` and applies
it once, before it deploys the Worker. Do not start a Worker whose migrations failed.
The `DB` binding names the database by the ID in `ALERTS_D1_DATABASE_ID` at build time, so a
deployment never provisions a second database. Without that variable the binding is local only.

D1 has no roles. Only the Worker binding and an API token with D1 permission reach the database.
The browser never receives a database credential. There are no user accounts.

D1 limits a row or a bound value to 2 MB, and has no stored procedures. So the Worker stores each
state value in ordered parts of at most 1 MB, and runs every multi-row change as one D1 batch, which
D1 executes as one transaction. The chronology commit checks its lease, revision and cursor inside
that batch through the named constraints of `alerts_guard`; a failed check rolls back every write.
Cloudflare's Time Travel keeps 30 days of point-in-time recovery on a paid plan.

The earlier Supabase schema had no recorded production installation. This port assumes none holds
data, so migration 0002 creates the archive empty and converts no legacy checkpoint. If an
installation does hold subscriptions, export them before the switch; nothing here reads Supabase.

### Existing checkpoints after the participation-window fix

The fix preserves the complete participation window during days without attestations.
It does not restore rounds removed by the previous wall-clock pruning rule.
A fresh installation can backfill finalized history with the corrected Worker.
Existing installations must check their recorded revision and retained window before accepting participation results.
Do not rerun initial migrations to repair missing rounds.

Do not delete only the `aegis` checkpoint. The SID archive retains `counted` tombstones,
which prevent those ceremonies from contributing rounds again. Deleting only tombstones is also unsafe.
Checkpoint and archive must describe the same history.

If inspection confirms missing rounds, prepare a recovery for that installation:

1. Stop its writer. Back up the checkpoint and archive together, including revisions and lease state.
2. Rebuild both from finalized events in isolated storage. Disable delivery during reconstruction.
3. Verify the finalized cursor/hash, membership, attendance, participation and consecutive misses.
   Keep attendance evaluation unavailable until reconstruction reaches the finalized head.
4. Preserve subscriptions and delivery records so previously accepted messages remain deduplicated.
5. Review and authorize an atomic replacement of the reconstructed checkpoint and archive.
   Invalidate old leases before resuming the corrected writer.

This is a recovery plan, not an automated migration or permission to delete production data.
No affected live installation has been verified. Confirm the actual state before planning an intervention.

Configure Worker bindings using the secret delivery mechanism. Do not put secret values in commands,
source files, logs or browser variables:

| Binding | Purpose |
| --- | --- |
| `APP_ORIGINS` | Comma-separated exact browser origins allowed to call the API, for example `https://safenet.cobuilders.eth.limo,https://safenet.cobuilders.xyz`. See [Allowed origins](#allowed-origins). |
| `APP_ORIGIN` | Legacy single origin. Still accepted, alone or merged with `APP_ORIGINS`. |
| `MAINNET_RPC_URL`, `GNOSIS_RPC_URL` | Mainnet reads/contract-wallet verification and finalized Aegis history. Must answer the expected chain ID. |
| `SUBGRAPH_URL_MAINNET` | Production Mainnet subgraph endpoint; a Studio development endpoint cannot support sustained subscription volume. |
| `REWARDS_BASE_URL` | Optional isolated-fork dataset override. Normally resolve the canonical ENS dataset, with core's repository fallback. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` | A dedicated bot token and its username, without `@`. Do not reuse a bot consumed by another getUpdates poller or webhook. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Persistent matching VAPID keypair and valid `mailto:` or HTTPS contact. Keep the private key server-side. |

### Allowed origins

The interface is served from more than one origin, such as the ENS/IPFS release at
`https://safenet.cobuilders.eth.limo` and `https://safenet.cobuilders.xyz`. List every origin
the Worker must serve in `APP_ORIGINS`. Set at least one of `APP_ORIGINS` and `APP_ORIGIN`.

* Each entry is a scheme, a host and an optional port. Entries are trimmed, lowercased and
  normalized, so a trailing slash is allowed. Paths, queries, fragments, credentials and
  wildcards are not. Plain `http` is allowed only for `localhost` and `127.0.0.1`.
* A malformed entry, or no entry at all, makes every API route except `/health` answer 503.
  The Worker never drops a bad entry silently.
* CORS echoes the request's `Origin` only when it matches an entry exactly. Every response
  sends `Vary: Origin`. Any other origin gets 403 and no CORS headers.
* The SIWE challenge names the request's origin as its `domain` and `uri`, so the wallet shows
  and checks the site the user is on. `/auth/verify` accepts a challenge only from the origin it
  names. A challenge from one origin redeemed from another answers 401 and stays unused.
  This is a consistency check: a client outside a browser can forge `Origin`. The wallet's own
  domain check protects users from phishing.
* Add a gateway only if it serves the interface from its own origin. Do not list a shared
  path-based gateway: every site behind that origin could then call the API.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the values.
Git ignores `.dev.vars`.

Set the web build's `VITE_ALERTS_API_URL` to the approved service origin. This is public and must
contain no credentials. Without it, the route explicitly reports that alerts are not configured.
The public VAPID key is returned by `/config`; the browser never receives provider credentials.

## Authentication and ownership

The server creates a five-minute SIWE challenge for core's Mainnet chain and the allowed origin
of the request. A signature is verified using viem's public client, including deployed ERC-1271 wallets.
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
  When registration is absent, `firstSeenAtBlock` supplies a stable key. It does not prove prior registration.
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
per recovery response, archive write payload, or checkpoint. The data-access layer measures compact JSON,
with non-ASCII characters escaped, so its byte checks can reject a payload slightly below the archive's limit.
The checkpoint retains at most 10,000 blocked attestations. Their original ordering and membership snapshots remain intact.
A single block above 1,000 logs, an oversized ceremony/checkpoint, or a blocked-attestation overflow fails closed.
These limits do not cap the number of unmatched ceremonies stored across batches.
Database storage grows with unmatched history; monitor storage and archive query latency before release.
There is no verified maximum attestation delay, so cleanup never deletes unmatched archive rows.

Delivery events have unique subscription/condition keys and a two-minute claim lease. Failures retry
on later polls. Provider acceptance stops automatic resends. A crash between sending and storing
acceptance can duplicate a message: providers do not offer an atomic transaction with D1.
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
Run `pnpm --filter @cobuilders/safenet-alerts report:uptime <from-UTC-ISO> <until-UTC-ISO>` with
`CLOUDFLARE_ACCOUNT_ID`, `ALERTS_D1_DATABASE_ID` and a `CLOUDFLARE_API_TOKEN` that can read D1 in the
environment. It reads `alerts_runs` through the D1 query API, pages aggregate runs and reports missing
slots as downtime.
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

Counted SIDs retain compact durable tombstones after the in-memory deduplication window expires.
This includes queued rounds released by another ceremony's completion, even without a new event for their SID.
An atomic commit permits 11,000 archive writes: 10,000 previously blocked rounds plus 1,000 input events.
The 8 MiB transfer/checkpoint bounds and 64 KiB ceremony bound still apply.
A repeated attestation cannot create a missing-completion blocker or count attendance twice.
Uncounted ceremonies still retain their shares for a delayed first attestation.
