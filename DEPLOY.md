# Deploy the REST API and the alerts Worker

This page deploys two Cloudflare Workers on their `workers.dev` URLs. No DNS record and no
custom domain is involved: `cobuilders.xyz` stays on GoDaddy, unchanged.

| Part | Worker | URL |
| --- | --- | --- |
| REST API, `apps/api` | `safenet-api` | `https://safenet-api.<subdomain>.workers.dev` |
| Alerts, `apps/alerts` | `safenet-alerts`, Cron every 5 minutes, D1 database `safenet-alerts` | `https://safenet-alerts.<subdomain>.workers.dev` |
| Web interface | Vercel (`safenet.cobuilders.xyz`) and IPFS (`safenet.cobuilders.eth.limo`) | unchanged |

`<subdomain>` is the account's workers.dev subdomain. The workflow
`.github/workflows/workers-deploy.yml` deploys the Worker code and secrets and applies the D1
migrations. There is no Terraform: without a zone, DNS or custom domains, it would manage one D1
database, and need a state bucket, its keys and another API token for that. One `cf d1 create`
does the same.

## What remains before the first deploy

1. **Workers Paid** on the Cloudflare account. On the free plan, a Cron run gets 10 ms of CPU and
   50 subrequests; one alerts poll needs far more.
2. **The D1 database and its ID.** With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the
   shell, from `apps/alerts`:
   ```sh
   pnpm exec cf d1 create --name safenet-alerts --read-replication-mode disabled
   ```
   Set the ID it prints as the `production` environment variable `ALERTS_D1_DATABASE_ID`.
3. **The two web URLs** as repository variables, and in Vercel: see [Web](#web-where-the-interface-finds-the-workers).

Everything else already exists. Never put a value in the repository.

### What the workflow reads, and from where

| Worker value | GitHub source | Level |
| --- | --- | --- |
| Cloudflare credentials | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `production` secrets |
| `MAINNET_RPC_URL` | `ALERTS_MAINNET_RPC_URL`, else `MAINNET_RPC_URL` | `production` secret, else organization secret |
| `GNOSIS_RPC_URL` | `ALERTS_GNOSIS_RPC_URL`, else `GNOSIS_RPC_URL` | `production` secret, else organization secret |
| `GRAPH_API_KEY` | `GRAPH_API_KEY` | organization secret. The Worker derives the Mainnet Network gateway URL from it through core |
| `SUBGRAPH_URL_MAINNET` | `ALERTS_SUBGRAPH_URL_MAINNET`, else the URL derived from `GRAPH_API_KEY` | optional `production` secret. Every deploy uploads one of the two, so removing the override takes effect on the next deploy |
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | repository secret |
| `TELEGRAM_BOT_NAME`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | same names | `production` variables |
| `VAPID_PRIVATE_KEY` | `VAPID_PRIVATE_KEY` | `production` secret |
| D1 binding | `ALERTS_D1_DATABASE_ID` | `production` variable |
| `APP_ORIGINS` | `ALERTS_APP_ORIGINS`, else `https://safenet.cobuilders.xyz,https://safenet.cobuilders.eth.limo` | optional `production` variable |
| API `GITHUB_TOKEN` | `SAFENET_API_GITHUB_TOKEN` | optional `production` secret. Without it the deploy warns, and GitHub allows the API 60 unauthenticated requests per hour |

`https://safenet.cobuilders.xyz` is also the Safe App origin: Safe{Wallet} loads the app in an
iframe from that origin. A new web origin must be added to `ALERTS_APP_ORIGINS`, or sign-in to
alerts answers 403 from it.

The Telegram bot must be dedicated to this Worker: no webhook and no other poller, because the
Worker reads `getUpdates`. Keep the VAPID pair for good: a new pair invalidates every browser
subscription.

### Web: where the interface finds the Workers

The interface reads two public build-time values. No code names a host:

| Value | Set it to |
| --- | --- |
| `VITE_VALIDATOR_INFO_URL` | `https://safenet-api.<subdomain>.workers.dev/v1/validators` |
| `VITE_ALERTS_API_URL` | `https://safenet-alerts.<subdomain>.workers.dev` |

- **IPFS release:** add both as GitHub *repository* variables. `release.yml` passes them to the
  build and lists them in the job summary, so a rebuild can reproduce the CID (`VERIFY.md`).
- **Vercel:** set both in the Vercel project, Production environment, then redeploy. Vercel builds
  from its own variables, not from `apps/web/build.env`.

Unset, the validator list reads SEF's published JSON and the alerts page says alerts are not
configured.

## Order of operations

1. Do the three steps in [What remains](#what-remains-before-the-first-deploy).
2. Run *Workers deploy* from `main` with target `both`, and approve it. The workflow tests each
   package, applies the D1 migrations, then deploys both Workers.
3. Check:
   ```sh
   curl -sS https://safenet-api.<subdomain>.workers.dev/v1/health
   API_URL=https://safenet-api.<subdomain>.workers.dev pnpm --filter @cobuilders/safenet-api smoke
   curl -sS https://safenet-alerts.<subdomain>.workers.dev/health   # 200 after the first good poll
   ```
4. Set the two web values on Vercel and redeploy it. Set them as repository variables before the
   next IPFS release. Cut that release only after the API answers: the validator list does not
   fall back to SEF when the API is down.

Later deploys: run the workflow again.

## Adding a custom domain later

The Worker configs set `workersDev: true` and declare no domain. To serve a Worker on a custom
domain, its hostname must be in a Cloudflare zone; a delegated subdomain zone such as
`safenet.cobuilders.xyz` needs the Enterprise plan. Then:

1. Add the domain to the Worker, in its config (`domains`) or in the dashboard.
2. Change the two web values to the new URLs, and add the new web origin to `ALERTS_APP_ORIGINS`
   if the interface moves too.

No code changes.

## Recovery

- D1 Time Travel restores the alerts database to any minute of the last 30 days.
- To remove a bad Worker version, roll back to the previous version in the Cloudflare dashboard.
- Never delete the `safenet-alerts` database: it holds subscriptions and delivery history.
