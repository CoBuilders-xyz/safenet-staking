# Deploy the REST API and the alerts Worker

This page deploys two Cloudflare Workers and their infrastructure:

| Part | Where | Public origin |
| --- | --- | --- |
| REST API, `apps/api` | Worker `safenet-api` | `https://api.safenet.cobuilders.xyz` |
| Alerts, `apps/alerts` | Worker `safenet-alerts`, Cron every 5 minutes, D1 database `safenet-alerts` | `https://alerts.safenet.cobuilders.xyz` |
| Web interface | Vercel (`safenet.cobuilders.xyz`) and IPFS (`safenet.cobuilders.eth.limo`) | unchanged |

Terraform in `infra/` owns the zone, the web DNS record, the D1 database and the two Workers
custom domains. The workflow `.github/workflows/workers-deploy.yml` owns the Worker code, its
secrets and the D1 migrations. The Worker configs declare no domains, so a deploy never changes the
custom domains.

Terraform state lives in a Cloudflare R2 bucket through the S3 backend, with `use_lockfile`.
R2 evaluates the lock file's conditional write atomically, so two operators cannot apply at once.
This keeps state with the resources it describes, costs nothing at this size and needs no second
vendor. R2 keeps no object versions: the state is small, and every resource can be re-imported.

## Decide first: which Cloudflare zone

`cobuilders.xyz` is on GoDaddy DNS. A Worker custom domain needs its hostname in a Cloudflare zone.
There are two ways:

| Option | `zone_name` | What it needs | Effect on `cobuilders.xyz` |
| --- | --- | --- | --- |
| A. Subdomain zone | `safenet.cobuilders.xyz` | A Cloudflare **Enterprise** plan. Cloudflare offers subdomain zones only on Enterprise. | None. GoDaddy delegates `safenet` with NS records. |
| B. Whole domain | `cobuilders.xyz` | Any plan. | Its name servers move to Cloudflare. Every existing record must be in Cloudflare first, including mail. |

Terraform supports both. For B, add `cobuilders.xyz` in the Cloudflare dashboard, which imports the
existing GoDaddy records, check them, then set `zone_name = "cobuilders.xyz"` and `create_zone = false`.
Terraform then manages only the Safenet records.

## Prerequisites

Do these once, by hand. Never put a value from this list in the repository.

1. **Cloudflare account** on the Workers Paid plan. The alerts poller exceeds the free plan's CPU
   and subrequest limits.
2. **State bucket.** Create the R2 bucket `safenet-terraform-state`. Create an R2 API token with
   *Object Read & Write* on that bucket only. Its access key ID and secret are the Terraform state
   credentials.
3. **Terraform API token**, for the operator who runs Terraform:
   - Account: *D1 Edit*, *Workers Scripts Edit*.
   - Zone (the Safenet zone): *Zone Edit*, *DNS Edit*, *Workers Routes Edit*.
   - Option A also needs permission to create the zone in the account.
4. **Deploy API token**, for GitHub Actions: start from the *Edit Cloudflare Workers* template, add
   *D1 Edit*, and limit it to this account and the Safenet zone.
5. **Telegram bot.** Create a dedicated bot with BotFather. Keep its token and its username without
   `@`. Set no webhook, and give the token to no other poller: the Worker reads `getUpdates`.
6. **RPC and subgraph endpoints** for alerts. Each one must answer the expected chain ID.
   - Mainnet RPC: reads, finalized blocks and ERC-1271 signature checks for Safe wallets.
   - Gnosis RPC: `eth_getLogs` over ranges of up to 2,000 finalized blocks.
   - Mainnet subgraph: the production query URL with its API key. A Studio development URL cannot
     carry sustained traffic.
7. **VAPID key pair** for Web Push. Run `npx web-push generate-vapid-keys` once and keep the pair
   for good: a new pair invalidates every browser subscription. The subject is a `mailto:` or
   `https:` contact.
8. **GitHub environment `production`.** Add a required reviewer and allow the branch `main` only.
   Then add the values below to that environment.

### GitHub `production` environment

Secrets:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy API token, step 4 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `ALERTS_MAINNET_RPC_URL` | Mainnet RPC URL |
| `ALERTS_GNOSIS_RPC_URL` | Gnosis RPC URL |
| `ALERTS_SUBGRAPH_URL_MAINNET` | Mainnet subgraph query URL, with its key |
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `SAFENET_API_GITHUB_TOKEN` | Optional. A GitHub token with no scope; it raises the rate limit of SEF's data on GitHub |

Variables, which are public:

| Name | Value |
| --- | --- |
| `ALERTS_D1_DATABASE_ID` | `terraform output -raw alerts_d1_database_id` |
| `TELEGRAM_BOT_NAME` | Bot username, without `@` |
| `VAPID_PUBLIC_KEY` | VAPID public key |
| `VAPID_SUBJECT` | For example `mailto:alerts@cobuilders.xyz` |
| `ALERTS_APP_ORIGINS` | Optional. Overrides the default `https://safenet.cobuilders.xyz,https://safenet.cobuilders.eth.limo` |

`https://safenet.cobuilders.xyz` is also the Safe App origin: Safe{Wallet} loads the app in an
iframe from that origin. A new web origin must be added to `ALERTS_APP_ORIGINS`, or sign-in to
alerts answers 403 from it.

### Vercel

Vercel builds `safenet.cobuilders.xyz` from its own project variables, not from `apps/web/build.env`.
In the Vercel project, Production environment, set:

```
VITE_VALIDATOR_INFO_URL=https://api.safenet.cobuilders.xyz/v1/validators
VITE_ALERTS_API_URL=https://alerts.safenet.cobuilders.xyz
```

The IPFS release reads the same two values from `apps/web/build.env`.

## Order of operations

1. **Terraform: zone and database.** In `infra/`, copy `backend.hcl.example` to `backend.hcl` and
   `terraform.tfvars.example` to `terraform.tfvars`, and fill them in. Set `web_cname_target` to the
   CNAME target that Vercel shows for `safenet.cobuilders.xyz`. Keep `attach_worker_domains = false`.
   ```sh
   export CLOUDFLARE_API_TOKEN=...      # Terraform API token
   export AWS_ACCESS_KEY_ID=...         # R2 state credentials
   export AWS_SECRET_ACCESS_KEY=...
   terraform init -backend-config=backend.hcl
   terraform plan -out=tfplan
   terraform apply tfplan
   terraform output
   ```
2. **Delegate DNS.** Option A: in GoDaddy, delete the `safenet` CNAME, then add one NS record for
   `safenet` per name server in `terraform output name_servers`. Option B: set the domain's name
   servers in GoDaddy to the ones Cloudflare shows. Wait until the zone is active in Cloudflare,
   then check that `https://safenet.cobuilders.xyz` still serves the app.
3. **GitHub values.** Add the secrets and variables above, including `ALERTS_D1_DATABASE_ID`.
4. **Deploy both Workers.** Run *Workers deploy* from `main` with target `both`, and approve it.
   The workflow tests each package, applies the D1 migrations, then deploys.
5. **Terraform: custom domains.** Set `attach_worker_domains = true`, then plan and apply again.
6. **Check.**
   ```sh
   curl -sS https://api.safenet.cobuilders.xyz/v1/health
   API_URL=https://api.safenet.cobuilders.xyz pnpm --filter @cobuilders/safenet-api smoke
   curl -sS https://alerts.safenet.cobuilders.xyz/health   # 200 after the first good poll
   ```
7. **Web.** Set the two Vercel variables and redeploy Vercel. Cut an IPFS release only after the
   API answers: the validator list does not fall back to SEF when the API is down.

Later deploys: run the workflow again. Run Terraform only when `infra/` changes.

## Recovery

- D1 Time Travel restores the alerts database to any minute of the last 30 days.
- To remove a bad Worker version, roll back to the previous version in the Cloudflare dashboard.
- `cloudflare_d1_database.alerts` has `prevent_destroy`. Terraform refuses to delete it.
