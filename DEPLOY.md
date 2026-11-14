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
| `TELEGRAM_WEBHOOK_SECRET` | `TELEGRAM_WEBHOOK_SECRET` | `production` secret. See [Telegram webhook](#telegram-webhook) |
| `ALERTS_URL` | `VITE_ALERTS_API_URL` | repository variable: the alerts Worker's own origin, which the web build also reads |
| `TELEGRAM_BOT_NAME`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | same names | `production` variables |
| `VAPID_PRIVATE_KEY` | `VAPID_PRIVATE_KEY` | `production` secret |
| D1 binding | `ALERTS_D1_DATABASE_ID` | `production` variable |
| `APP_ORIGINS` | `ALERTS_APP_ORIGINS`, else `https://safenet.cobuilders.xyz,https://safenet.cobuilders.eth.limo` | optional `production` variable |
| API `GITHUB_TOKEN` | `SAFENET_API_GITHUB_TOKEN` | optional `production` secret. Without it the deploy warns, and GitHub allows the API 60 unauthenticated requests per hour |

`https://safenet.cobuilders.xyz` is also the Safe App origin: Safe{Wallet} loads the app in an
iframe from that origin. A new web origin must be added to `ALERTS_APP_ORIGINS`, or sign-in to
alerts answers 403 from it.

The Telegram bot must be dedicated to this Worker: a bot has one webhook, and it is this Worker's.
Keep the VAPID pair for good: a new pair invalidates every browser subscription.

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
2. Run *Workers deploy* from `main` with target `both` and `telegram_webhook` on, and approve it.
   The workflow tests each package, applies the D1 migrations, deploys both Workers, then
   registers the Telegram webhook ([Telegram webhook](#telegram-webhook)).
3. Check:
   ```sh
   curl -sS https://safenet-api.<subdomain>.workers.dev/v1/health
   API_URL=https://safenet-api.<subdomain>.workers.dev pnpm --filter @cobuilders/safenet-api smoke
   curl -sS https://safenet-alerts.<subdomain>.workers.dev/health   # 200 after the first good poll
   ```
4. Set the two web values on Vercel and redeploy it. Set them as repository variables before the
   next IPFS release. Cut that release only after the API answers: the validator list does not
   fall back to SEF when the API is down.

Later deploys: run the workflow again. Leave `telegram_webhook` off unless the secret or the
Worker's URL changed: the registration stays.

## Telegram webhook

Telegram pushes every `/start` and every "Confirm receipt" press to
`https://safenet-alerts.<subdomain>.workers.dev/telegram/webhook`, so a chat links, and a button
answers, within a second or two. The Worker accepts a request only with the secret that Telegram
was given. It never calls `getUpdates`. `apps/alerts/README.md` describes the endpoint.

### Set it up

1. **Create the secret** as a `production` environment secret. Telegram allows `A-Z`, `a-z`, `0-9`,
   `_` and `-`; the Worker asks for at least 32 characters. This writes 64 random characters to
   GitHub without showing them:
   ```sh
   openssl rand -hex 32 | gh secret set TELEGRAM_WEBHOOK_SECRET --env production --repo <owner>/<repository>
   ```
   No one needs to read the value afterwards: the workflow gives it to the Worker and to Telegram.
2. **Check the Worker's URL.** The repository variable `VITE_ALERTS_API_URL` must be the alerts
   Worker's origin ([Web](#web-where-the-interface-finds-the-workers)). The workflow registers
   `<that origin>/telegram/webhook`.
3. **Deploy and register.** Run *Workers deploy* from `main` with target `alerts` (or `both`) and
   `telegram_webhook` on. After the deploy, the step *Register the Telegram webhook* calls
   `setWebhook` with the URL, the secret, `allowed_updates=["message","callback_query"]` and
   `drop_pending_updates=true`, reads the registration back, and fails unless Telegram holds that
   URL. A deploy fails before it uploads the Worker when the secret or `VITE_ALERTS_API_URL` is
   missing, when the secret is not 32 to 256 characters of the allowed alphabet, or when the URL is
   not an https origin. The error names the value and never shows it.

Between the deploy and the registration, a few seconds, nothing reads Telegram. A `/start` or a
receipt press sent in that gap, or before it, is dropped by `drop_pending_updates`. Nothing is lost
for good: the alerts page shows that subscription as still waiting, and opening its link again, or
a new link, connects it. The registration drops them on purpose: on the move from polling,
Telegram would otherwise deliver again the updates that the last poll already handled.

### Verify

1. The job summary shows a *Telegram webhook* block. It must start with
   `webhook: registered for this Worker`, list `message, callback_query`, and show no last error.
   The same report, at any time, with the bot token in the shell:
   ```sh
   ALERTS_URL=https://safenet-alerts.<subdomain>.workers.dev pnpm --filter @cobuilders/safenet-alerts telegram:webhook info
   ```
2. The endpoint refuses a request without the secret:
   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://safenet-alerts.<subdomain>.workers.dev/telegram/webhook   # 401
   ```
   503 instead means the deployed Worker has no usable secret.
3. `curl -sS https://safenet-alerts.<subdomain>.workers.dev/health` answers 200 after the next
   poll, at most five minutes later. Each poll asks Telegram whether the webhook it holds is this
   Worker's URL and is delivering, and a run is unhealthy when it is not. A webhook registered for
   another deployment of the same bot is unhealthy here.
4. In the interface: subscribe with Telegram, open the link and press Start. The bot answers
   "Linked." at once, and the card shows *Connected* within about two seconds. Press *Get test
   notification*: the message arrives in the chat, and the card says it was sent.

### Rotate the secret

Repeat [Set it up](#set-it-up): write a new secret, then deploy with `telegram_webhook` on. For the
few seconds between the deploy and the registration, Telegram still sends the old secret and the
Worker answers 401. The registration then drops those updates, as above: a user who pressed Start
in those seconds opens the link again.

### Roll back to polling

The Worker versions before the webhook read `getUpdates` on each Cron run. To go back:

1. Remove the webhook. Telegram keeps the updates that wait, for the poller. With
   `TELEGRAM_BOT_TOKEN` in the shell:
   ```sh
   pnpm --filter @cobuilders/safenet-alerts telegram:webhook delete
   ```
2. Roll the `safenet-alerts` Worker back, in the Cloudflare dashboard, to the last version before
   the webhook. That version polls again, and links a chat on the Cron run after Start, up to five
   minutes later. The interface keeps working against it: its cards connect more slowly, and the
   test button shows no countdown.

Do both steps. A webhook version with no webhook, or a polling version with one, links no chat.
The D1 migration needs no rollback: the older version ignores the two tables it added.

The interface and the Worker can be released in either order. The page of this change works
against the polling Worker: its cards connect on the next Cron run, and the test button has no
countdown. Deploy the Worker and register the webhook first when you can, so that no user sees
"This card updates as soon as you do" while the old Worker still takes up to five minutes.

To set the webhook from a shell instead of the workflow, with `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET` (the deployed value) and `ALERTS_URL` in the environment:

```sh
pnpm --filter @cobuilders/safenet-alerts telegram:webhook set
```

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
