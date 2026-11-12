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

## Prerequisites

Do these once, by hand. Never put a value from this list in the repository.

1. **Cloudflare account** on the Workers Paid plan. The alerts poller exceeds the free plan's CPU
   and subrequest limits. In *Workers & Pages*, choose the account's workers.dev subdomain if it
   has none. Both Worker URLs use it.
2. **Deploy API token**, for GitHub Actions: start from the *Edit Cloudflare Workers* template, add
   *D1 Edit*, and limit it to this account.
3. **D1 database.** With that token in `CLOUDFLARE_API_TOKEN` and the account ID in
   `CLOUDFLARE_ACCOUNT_ID`, from `apps/alerts`:
   ```sh
   pnpm exec cf d1 create --name safenet-alerts --read-replication-mode disabled
   ```
   Keep the database ID it prints. Without read replicas, every read sees the last write.
4. **Telegram bot.** Create a dedicated bot with BotFather. Keep its token and its username without
   `@`. Set no webhook, and give the token to no other poller: the Worker reads `getUpdates`.
5. **RPC and subgraph endpoints** for alerts. Each one must answer the expected chain ID.
   - Mainnet RPC: reads, finalized blocks and ERC-1271 signature checks for Safe wallets.
   - Gnosis RPC: `eth_getLogs` over ranges of up to 2,000 finalized blocks.
   - Mainnet subgraph: the production query URL with its API key. A Studio development URL cannot
     carry sustained traffic.
6. **VAPID key pair** for Web Push. Run `npx web-push generate-vapid-keys` once and keep the pair
   for good: a new pair invalidates every browser subscription. The subject is a `mailto:` or
   `https:` contact.
7. **GitHub token for the API**: a fine-grained token with no permissions. It raises GitHub's rate
   limit for SEF's data. `cf` requires every secret a Worker declares, so the deploy stops without it.
8. **GitHub environment `production`.** Add a required reviewer and allow the branch `main` only.
   Then add the values below to that environment.

### GitHub `production` environment

Secrets:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy API token, step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `ALERTS_MAINNET_RPC_URL` | Mainnet RPC URL |
| `ALERTS_GNOSIS_RPC_URL` | Gnosis RPC URL |
| `ALERTS_SUBGRAPH_URL_MAINNET` | Mainnet subgraph query URL, with its key |
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `SAFENET_API_GITHUB_TOKEN` | GitHub token, step 7 |

Variables, which are public:

| Name | Value |
| --- | --- |
| `ALERTS_D1_DATABASE_ID` | The ID from step 3 |
| `TELEGRAM_BOT_NAME` | Bot username, without `@` |
| `VAPID_PUBLIC_KEY` | VAPID public key |
| `VAPID_SUBJECT` | For example `mailto:alerts@cobuilders.xyz` |
| `ALERTS_APP_ORIGINS` | Optional. Overrides the default `https://safenet.cobuilders.xyz,https://safenet.cobuilders.eth.limo` |

`https://safenet.cobuilders.xyz` is also the Safe App origin: Safe{Wallet} loads the app in an
iframe from that origin. A new web origin must be added to `ALERTS_APP_ORIGINS`, or sign-in to
alerts answers 403 from it.

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

1. Do the prerequisites. Add the secrets and variables of the `production` environment.
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
