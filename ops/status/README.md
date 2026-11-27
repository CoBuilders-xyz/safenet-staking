# Status page

The public status page of Safenet staking, at `status.safenet.cobuilders.xyz` once deployed. It is
[Gatus](https://github.com/TwiN/gatus) v5.38.0, pinned by digest in the `Dockerfile`, with
`config.yaml` from this directory. It checks each production service every one to five minutes,
keeps the uptime, alerts Slack and Friday, and serves the page and a public API.

The Availability workflow (`.github/workflows/availability.yml`) still runs every six hours. It
does what Gatus cannot: it fetches the entry script that the index names, and it reads the CID
from a response header.

## What is checked

| Group | Check | Every | Healthy when | Severity |
|---|---|---|---|---|
| Web | Web app (safenet.cobuilders.xyz) | 1 min | 200, the title, an entry script under `assets/` | P1 |
| Web | Web app via ENS (safenet.cobuilders.eth.limo) | 2 min | the same | P1 |
| Distribution | IPFS gateway Filebase | 5 min | `/ipns/safenet.cobuilders.eth/index.html` answers 200 with the title | P2 |
| Distribution | IPFS gateway Orbitor | 5 min | the same | warning |
| Distribution | npm @cobuilders/safenet-cli, npm @cobuilders/safenet-mcp | 24 h | the registry answers the package's `latest` dist-tag with its name: the package is installable. It does not check which version `beta` names | P2 |
| API | API health | 5 min | `/v1/health` answers 200 with `"status": "ok"` | P1 |
| API | API validators | 2 min | `/v1/validators` answers 200 with a JSON array whose first element has an `address` | P1 |
| Alerts | Alerts health | 2 min | `/health` answers 200 with `"healthy": true` | P1 |
| Indexing | Mainnet subgraph (Network), Gnosis subgraph (Network) | 5 min | the Network gateway answers `_meta` with a block and `hasIndexingErrors: false` | P2 |
| Indexing | Mainnet subgraph (Studio fallback), Gnosis subgraph (Studio fallback) | 5 min | the same, on the Studio deployments in `packages/core` | P2 |

Three suites check correctness. Gatus alerts on them but keeps no uptime for them:

| Group | Suite | Every | Healthy when | Severity |
|---|---|---|---|---|
| Web | ENS and Vercel serve the same release | 5 min | eth.limo serves the same `index.html` as Vercel, byte for byte | P2 |
| Indexing | Mainnet subgraph is fresh | 10 min | the Network subgraph answers at the chain's finalized block, by hash | P2 |
| Indexing | Gnosis subgraph is fresh | 10 min | the same on Gnosis | P2 |

`tools/__tests__/status-config.test.mjs` fails when `packages/core` changes a subgraph ID, a Studio
version, a gateway, the ENS name or a public RPC and `config.yaml` does not follow. A new Studio
version in core therefore needs the same change here.

### How a release is followed

Nothing changes here after a release. No CID is configured:

- The two web checks and the ENS suite compare what the origins serve. A release moves Vercel,
  then the ENS name, so the suite fails only if the two stay on different releases for three runs.
- The gateways resolve `/ipns/safenet.cobuilders.eth`, so they serve the CID the name points at.

### Limits of what Gatus can check

- Gatus reads the status, the body and the time. It cannot read a response header such as
  `x-ipfs-roots`, and it cannot fetch a URL taken from a body, such as the entry script. The
  Availability workflow does both every six hours.
- Gatus cannot compute an age from a timestamp. So freshness uses the chain's finalized block:
  the subgraph must have indexed it. That bounds the lag to finality, about 15 minutes on Mainnet
  and about 3 on Gnosis. The finalized block comes from the first public RPC in `packages/core`.
  When that RPC is down, the freshness suite fails at its first step and sends no alert.
- A gateway check proves that the gateway resolves the ENS name and serves the release. A gateway
  that serves CIDs but cannot resolve ENS names fails it.
- The Friday payload carries no error text. Gatus escapes almost nothing it substitutes, so an
  error message could make the JSON invalid and lose the alert. The page shows the errors.
- When an alert cannot be delivered, Gatus logs the Go error, which names the URL it posted to.
  For Slack, that URL is the webhook and its credential. Treat the Railway logs as secret, and
  rotate the Slack webhook if they leak.
- Every check runs from Railway. A network outage there counts as downtime of every service.

## Alerts

| Severity | Where | After | Meaning |
|---|---|---|---|
| P1 | Slack and Friday | 3 failures in a row (2 for API health) | users cannot reach the web app, the API or alerts |
| P2 | Friday | 3 failures in a row (1 for npm) | a redundant piece is down; users have another path |
| warning | Friday | 4 failures in a row | Orbitor's gateway, which answers 504 now and then |

Each alert also goes out when the check recovers, after 2 successes in a row. Gatus waits for the
threshold before it alerts, but the page and the uptime count every failed check.

Friday receives one JSON object per alert, with the header `Authorization: Bearer <FRIDAY_WEBHOOK_KEY>`:

```json
{"source":"safenet-status","severity":"P1","status":"triggered","group":"Web","name":"Web app (safenet.cobuilders.xyz)","url":"https://safenet.cobuilders.xyz/","description":"P1: users cannot reach this service"}
```

`status` is `triggered` or `resolved`. `severity` is `P1`, `P2` or `warning`.

## Environment

Set these on the Railway service. Never write a value in this repository.

| Name | Required | What it is |
|---|---|---|
| `GRAPH_API_KEY` | yes | The Graph gateway key for the subgraph checks. Gatus sends it in a header, never in a URL, so the page and the alerts do not show it |
| `SLACK_WEBHOOK_URL` | yes | A Slack incoming webhook, for P1 alerts |
| `FRIDAY_WEBHOOK_URL` | yes | Friday's webhook, for every alert |
| `FRIDAY_WEBHOOK_KEY` | yes | The bearer token Friday expects |
| `GATUS_SQLITE_PATH` | no | The SQLite file. Default `/data/gatus.db`, on the volume |
| `PORT` | no | Railway sets it. Default 8080 |

Without a Slack or Friday value, Gatus starts and ignores that provider: it logs
`ignoredProviders=[...]` and sends nothing there. Without `GRAPH_API_KEY`, the Network checks fail.

## Deploy on Railway

1. Create a service from this repository. Set its root directory to `ops/status`, and its config
   file path to `/ops/status/railway.toml`: Railway does not look for the config file in the root
   directory. It then builds the `Dockerfile` and uses `/health` as the health check.
2. Add a volume and mount it at `/data`. Without it, a redeploy deletes the uptime history.
3. Set the variables in [Environment](#environment).
4. Deploy.
5. Under Networking, add the custom domain `status.safenet.cobuilders.xyz`. Railway shows a
   CNAME target. At GoDaddy, in the DNS of `cobuilders.xyz`, add a CNAME record with the name
   `status.safenet` and that target. Railway issues the certificate once the record resolves.
6. Set the repository variable `STATUS_URL` to `https://status.safenet.cobuilders.xyz`, for the
   weekly export.

To check a change before it merges, run `bash ops/status/check-config.sh`. It needs Docker and no
secret. CI runs it as the `status-config` job of `ci.yml`.

### Announcements

Gatus can show a notice above the checks, for planned maintenance or an incident. Add a
top-level `announcements` list to `config.yaml`, not under `ui`, then redeploy:

```yaml
announcements:
  - timestamp: 2026-12-01T10:00:00Z
    type: warning # outage, warning, information, operational or none
    message: Planned maintenance of the alerts Worker, 10:00 to 10:30 UTC.
```

## Retention and the uptime record

Gatus v5.38.0 keeps, per check (`storage/store/sql/sql.go`):

- uptime by hour, merged into days after 48 hours. Gatus deletes entries older than 30 days
  once the oldest is over 32 days old. So the page and the API show 30 days at most;
- the last 1,500 results (`maximum-number-of-results`), about a day for a check every minute;
- the last 1,000 changes of state (`maximum-number-of-events`), with no age limit.

Gatus alone cannot show 12 months. `.github/workflows/uptime-export.yml` runs every Monday and on
demand. It reads the public API at `STATUS_URL` and writes a JSON and a Markdown report as an
artifact. Per check, the report has:

- Gatus's uptime for 24 hours, 7 days and 30 days: successful checks over all checks;
- the share of time healthy, from the changes of state, for the last 8 days, the month to date
  and the previous month, with how much of each window the data covers. Time before the oldest
  change Gatus kept counts as not observed, never as up or down;
- each period of downtime in the last 8 days.

The 8-day window overlaps the run before, so a run that fails or comes late loses nothing.

With the repository variables `CLOUDFLARE_ACCOUNT_ID` and `ALERTS_D1_DATABASE_ID`, and the
repository secret `ALERTS_D1_READ_TOKEN`, a Cloudflare token that can only read D1, the export
also adds the alerts Worker's own poll report (`apps/alerts/README.md`). Without them, the run says
so and skips that part. The report covers the same three windows. It counts a missing five-minute
slot as downtime, so a month in which the Worker was first deployed shows the time before the deploy
as down.

GitHub keeps an artifact for 90 days at most. So the long-term record is the sequence of exports,
and each one must be kept somewhere else within 90 days, for example on the COB-539 issue in
Linear. The workflow writes nothing to the repository.

A red export run opens a `ci-red` issue, as the other scheduled workflows do. It is red until
`STATUS_URL` is set.

## Query budget

At these intervals, the status page sends about 26,000 queries a month to the Network gateway:
two checks every 5 minutes and two freshness queries every 10 minutes. The API's `/v1/health`,
checked every 5 minutes, sends about 17,000 more, from the API Worker's own key. Each Studio
deployment receives about 290 queries a day, well under its limit of about 3,000.
