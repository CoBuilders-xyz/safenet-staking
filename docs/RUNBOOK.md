# Operational runbook

This runbook describes the repository's implemented controls. It does not prove deployment,
publication, notification delivery or an active support contract. Record the actual deployment
revision, endpoints, owners and acceptance evidence in the operator's private operations record.
Never put credentials, wallet-to-chat mappings or push subscription endpoints in that record's public copy.

## Assign before delivery

The release owner must assign a primary operator and backup for each service: web/IPFS/ENS,
Mainnet and Gnosis indexing, REST API, Alerts/Supabase, npm/binaries and incident response.
Record notification routing, support hours, escalation contacts, billing, renewal dates and the
approved evidence-retention location. These are operator decisions, not repository defaults.

Obtain approved Terms, Privacy and Imprint text before describing legal pages as complete.
A configured Terms URL is not a substitute for the full approved legal-page set.
Confirm the sanctions provider and screening scope with the operator; a working oracle and
optional endpoint do not establish coverage of every required list or jurisdiction.

## Service map

| Surface | Implementation and operational evidence | External dependency |
| --- | --- | --- |
| Web | `apps/web`; release CAR/CID; browser smoke and accessibility reports | Public RPCs, SEF data, subgraphs, approved wallet integrations |
| Validator API | [API README](../apps/api/README.md); six routes; freshness headers; `/v1/health` | Worker account, GitHub token, production subgraph capacity, rate limits |
| Alerts | [Alerts README](../apps/alerts/README.md); `/health`; aggregate `alerts_runs` | Paid Worker plan, Supabase migrations/secrets, Telegram, VAPID and approved recipients |
| Daily snapshots | [Snapshot README](../packages/snapshots/README.md); dated index on `snapshots` branch | Archive RPC, Pinata credentials and healthy gateways |
| CLI/MCP | [CLI](../packages/cli/README.md), [MCP](../packages/mcp/README.md), installed-package and binary checks | RPC; user-controlled signer for writes; npm publication permissions |
| Indexers | [Mainnet](../packages/subgraph-mainnet/CLAUDE.md), [Gnosis](../packages/subgraph-gnosis/CLAUDE.md) | Studio or Graph Network publication and gateway access |

## Routine checks

All workflow schedules use UTC. GitHub schedules can run late; inspect the last completed run,
not just the configured cron. A missed run is missing evidence, not a successful check.

| Workflow | Cadence | Check and response |
| --- | --- | --- |
| `availability.yml` | Every six hours, minute 29 | Production title and entry JavaScript; recorded release through configured gateways. Inspect every target. |
| `nightly.yml` | Daily, 03:17 | Unit, live smoke, deep ABI and fork suites; inspect skipped jobs as well as failures. |
| `parity.yml` | Daily, 06:43 | Compare chain/subgraph figures with SEF's publication window. Distinguish stale and not-comparable from matches. |
| `snapshots.yml` | Daily, 00:37 | Verify the day's published snapshot and date-index entry. PR runs are offline fixture checks, not publication. |
| Alerts poller | Five-minute slots | Inspect private health and aggregate runs. Missing slots count as downtime. |

Scheduled workflow failures call `page-on-red.yml`, which opens or updates a `ci-red` GitHub issue.
The operator must subscribe an attended notification route. A created GitHub issue alone does
not prove that anyone received or acknowledged an incident. Do not close an incident merely
because a rerun turns green; record cause, affected interval, recovery and retained evidence.

## Triage

1. Record UTC time, deployed revision, failed route/job and its public error code. Do not copy raw secrets or provider exception bodies.
2. Confirm the failing surface and compare with an independent source. Keep chain, SEF, subgraph and gateway failures distinct.
3. Check source freshness, indexing errors and programme membership. Do not turn unavailable data into zero or bypass fail-closed controls.
4. Inspect the relevant workflow/job logs and aggregate metrics. Preserve bounded logs before their retention expires.
5. Apply only an approved recovery action. Record its scope and result, then repeat the affected smoke checks.

For availability failures, inspect production HTML, its JavaScript and each gateway separately.
A gateway 504 can coexist with healthy production and another working gateway. Record the matrix;
do not use `continue-on-error` to hide production failures. Any non-blocking gateway policy must
be explicit, tested and approved in code. Keep release pin verification separate from monitoring.

For API 503 responses, inspect `/v1/health` and `X-Data-Sources`/`X-Data-Expires-At` on data routes.
Check upstream block age, errors, SEF publication age and GitHub request quota. Do not increase
freshness bounds to conceal an outage. Use the documented Worker secret binding for GitHub auth;
never put the token in a URL or frontend build variable.

For alerts, separate subscription authentication, source evaluation, enqueueing, provider acceptance
and actual device delivery. A provider acceptance counter is not a receipt from a recipient.
Follow the archive/checkpoint recovery procedure in the Alerts README. Do not clear deduplication,
replay deliveries or reset checkpoints without assessing duplicate-notification risk.

For a missing snapshot day, inspect the build and pinned source points before retrying. A repeated
publication normally retains the existing day. Use replacement only with explicit approval.
Keep snapshot input, index input and publication output in distinct directories. Verify both
`index.json` and `INDEX_CID` before publishing; do not repair them by deleting history.

## Recovery and rollback

- Web: preserve the prior release CID and deployment record. Verify its assets first. Changing ENS contenthash requires the owner's explicit signature.
- API/Alerts: retain the last reviewed Worker artifact and configuration inventory. Roll back only through the approved deployment account. Check database compatibility first.
- Supabase: test backup restoration in an isolated environment. Restore schema and retention policies as well as data. Never put production subscription data into public QA fixtures.
- Subgraphs: retain deployment IDs and schema versions. Switching a production gateway requires parity checks and an approved configuration change.
- npm: published versions are immutable. Prefer a corrected version and approved dist-tag change; do not assume a local git revert retracts a published package.

These steps describe decisions for the operator. Repository QA must not execute publication,
deployment, ENS/Graph transactions or database recovery without separate authorization.

## Release and acceptance record

Use pinned Node from `.nvmrc`, the frozen lockfile and [VERIFY.md](../VERIFY.md). Rebuild the
web release twice and compare CIDs before pinning. Keep public build inputs and dependency
versions with the evidence. A release workflow dispatch defaults to pinning; explicitly disable
`pin` for an artifact-only run. npm publication also requires an explicit release decision.

Record each service's exact deployed revision, artifact checksum/CID, production endpoint,
configuration names (never secret values), smoke results and operator approval. Record separately:

- Real Safe App iframe load, manifest/icon access, wallet connection and approved signing acceptance.
- Hardware-wallet and WalletConnect acceptance on each supported platform/device.
- Public API warm/cold p95 with region, sample size, concurrency, error rate and source freshness.
- Telegram and Web Push delivery to approved test recipients, with real receipts.
- Graph Network gateway access and parity; a Studio deploy is not Graph Network publication.
- Clean npm installation and binary checksum verification on each supported platform; real MCP-client handshake and tool use.

## Reporting collection and retention

Collect a monthly evidence bundle with UTC start/end, revisions, workflow links and per-job
conclusions, availability target outcomes, API sample measurements, snapshot day coverage,
incident intervals and alert uptime aggregates. Link exceptions and approvals explicitly.
Do not infer twelve-month availability from a short QA run.

Alerts already retains thirteen months of aggregate `alerts_runs`. With an approved service
credential supplied through the operator's secret manager, export an aligned range:

```sh
pnpm --filter @cobuilders/safenet-alerts report:uptime <from-UTC-ISO> <until-UTC-ISO>
```

Both endpoints must align to five-minute boundaries. The report includes absent slots as downtime.
Do not export subscription rows, wallet addresses, chat IDs or push endpoints as delivery evidence.

Release and snapshot workflow artifacts have bounded retention; other CI artifacts follow their
workflow or repository setting. Export required evidence before expiry. The operator must provision
a retained private archive, monthly collection ownership and renewal reminders. This repository
has no universal scheduled monthly evidence exporter; the commands and workflow artifacts above
are its available collection sources. Record that limitation until collection is provisioned.

Use [the API load tool](../apps/api/README.md#load-evidence) for latency samples, the repository's
metrics report for source-labelled figures, and workflow job summaries for availability and parity.
Review aggregate trends, missing intervals, credential rotation and provider billing monthly.
