# Safenet staking interface

The web interface for staking SAFE to Safenet validators on Ethereum Mainnet. It runs in any
browser with an injected wallet or WalletConnect, and inside Safe{Wallet} as a Safe App. It
reads the staking and MerkleDrop contracts directly, the two subgraphs in this repository for
the Network Overview, and the files the Safe Ecosystem Foundation (SEF) publishes for validator
metadata and rewards.

This package is `@cobuilders/safenet-web` in the repository's pnpm workspace. It derives from
Safe Foundation's safenet-staking-ui; see [License](#license).

## Screens

| Path | Page | What it shows |
|------|------|---------------|
| `/` | `OverviewPage` | Network Overview, no wallet needed: headline figures, stake distribution, rewards with the root check, the validator table, the last 30 days, and the freshness of each subgraph |
| `/dashboard` | `DashboardPage` | My stake. With a wallet: staking stats, the claimable banners, quick actions, the staking section and the stake distribution chart. Without one: a connect prompt and a link to Validators |
| `/validators` | `ValidatorsPage` | Validator cards with Delegate and Undelegate. `?delegate=<address>` opens the delegate dialog for that validator |
| `/validators/:address` | `ValidatorDetailPage` | One validator's figures and actions |
| `/withdrawals` | `WithdrawalsPage` | The withdrawal queue, oldest first, with cooldowns and Claim |
| `/rewards` | `RewardsPage` | Your rewards, Claim, Claim & Stake, bounded per-account claim history, programme totals, and the root on chain checked against SEF's published one |
| `/alerts` | `AlertsPage` | Wallet-signed subscriptions, delivery settings and explicit configuration status |
| `*` | `NotFoundPage` | 404 |

Terms are explained where they appear: a dotted-underlined word opens its explanation on hover,
focus or a tap (`Term`, from `src/lib/glossary.ts`). Before a stake goes to the wallet, "What
happens if" answers five questions: getting the SAFE back, switching validators, a drop in
participation, something going wrong, and lower rewards.

The router is `HashRouter` (`src/App.tsx`), so every path is served from one `index.html`
under `#/`, which a static host and an IPFS gateway can both serve.

Reward history covers the latest 12 distributions and up to 999 claims within that range.
It shows payments claimed during each root's lifetime, not rewards earned in that period.
Older history is excluded. Per-period earnings remain unknown.
Each window uses whole blocks, so a claim before a root update in the same block enters the new window.
Exact event-order attribution is unavailable.
The reader checks cumulative claims against Ethereum at every window boundary.
A full claim page, missing records, or a chain mismatch makes the history incomplete and hides all amounts.
Stale indexes or failed historical reads make history unavailable. Neither state implies zero rewards.

## Quick start

You need the Node version in the repository's `.nvmrc` and pnpm. From the repository root:

```bash
pnpm install
pnpm --filter @cobuilders/safenet-web dev
```

Vite serves the app on its default port, 5173, or on `WEB_PORT` from the repository-root
`.env.ports` when `pnpm bootstrap` has written one. No environment variable is needed: the chain,
the contract addresses, the RPC endpoints, the scan floor and the subgraph endpoints all default
to the values in `packages/core`.

`pnpm bootstrap` prepares everything in one step, including the Playwright browser and the
per-worktree ports, but it also requires Foundry, Docker and the GitHub CLI to be installed.
For this package alone, `pnpm install` is enough.

To run the tests:

```bash
pnpm --filter @cobuilders/safenet-web test                                 # Vitest unit tests
pnpm --filter @cobuilders/safenet-web exec playwright install chromium     # once, for e2e
pnpm --filter @cobuilders/safenet-web test:e2e                             # Playwright, mocked RPC
```

Run every script in this package as `pnpm --filter @cobuilders/safenet-web <script>` from the
repository root, or as `pnpm <script>` from `apps/web`.

## Environment variables

Vite reads env from the repository root, not from this directory: the root `.env`, and the root
`.env.local` that `pnpm env:pull` writes. Every variable is optional. To set one by hand, copy
it from [`.env.example`](.env.example) into the root `.env`.

Vite writes used `VITE_` values into the public bundle. Never put private credentials in them.
COB-566 explicitly permits `VITE_GRAPH_API_KEY` as a public, subgraph-restricted, USD 20/month-capped browser key.
`pnpm check:browser`, part of `pnpm check`, fails when a value from `.env.local` that is not a
`VITE_` value turns up in a build.

| Variable | Effect when set | Unset |
|----------|-----------------|-------|
| `VITE_RPC_URL`, `VITE_RPC_URL_FALLBACK_1`, `VITE_RPC_URL_FALLBACK_2` | JSON-RPC endpoints, tried in this order. They replace the built-in list; they do not extend it | The Mainnet list in `packages/core` |
| `VITE_CHAIN_ID` | Selects which chain's default RPC list and scan floor are read from `packages/core`. Contract addresses and the wallet chain stay Mainnet whatever its value | `DEFAULT_CHAIN_ID` in `packages/core`. Core configures Mainnet only, so leave it unset |
| `VITE_STAKING_DEPLOY_BLOCK` | Block to start historical log scans from | The scan floor in `packages/core` |
| `VITE_MERKLE_DROP_ADDRESS` | Overrides the MerkleDrop contract address | The address in `packages/core` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Enables the WalletConnect connector | No WalletConnect option |
| `VITE_VALIDATOR_INFO_URL` | Validator metadata JSON | SEF's published file, `SEF_DATA.validatorInfo` in `packages/core` |
| `VITE_REWARDS_BASE_URL` | Base for `latest.json` and the proof files. Replaces every other source | SEF's IPFS dataset, then the repository; see [Where reward data comes from](#where-reward-data-comes-from) |
| `VITE_IPFS_GATEWAY` | A gateway tried before the public ones for SEF's dataset. Only its origin is used | Only the gateways in `packages/core` |
| `VITE_GRAPH_API_KEY` | Public browser gateway key (COB-566); inject at build time, restrict subgraphs and spending | Unset: Studio fallback |
| `VITE_SUBGRAPH_URL_MAINNET`, `VITE_SUBGRAPH_URL_GNOSIS` | Explicit subgraph query URLs; override the gateway per chain. Public in the bundle | Network gateway when `VITE_GRAPH_API_KEY` is set; otherwise Studio account 1763864 (rate-limited development endpoints) |
| `VITE_SANCTIONS_API_URL` | Fetched on load; an HTTP 403 blocks the app, and so does a failed request | No IP sanctions check |
| `VITE_GEOBLOCK_CACHE_DAYS` | Days the country lookup is cached in `localStorage` | 7 |
| `VITE_PLAUSIBLE_DOMAIN`, `VITE_PLAUSIBLE_ENDPOINT` | Enables Plausible page views, to that domain and optionally that endpoint | No analytics |
| `VITE_APP_URL` | Canonical URL for the `og:url`, `og:image` and `twitter:image` tags in `index.html`, absolute, no trailing slash | The tags carry no origin |
| `VITE_DOCS_URL` | Footer documentation link | Safe Foundation's Safenet documentation, set in `src/components/layout/Footer.tsx` |
| `VITE_ALERTS_API_URL` | Public Alerts Worker origin; see [Alerts provisioning](../alerts/README.md) | Alerts displays that the service is not configured |
| `VITE_TERMS_URL`, `VITE_PRIVACY_URL`, `VITE_IMPRINT_URL` | Footer links | Hidden |

`GRAPH_NODE_PORT` from `.env.ports` reaches the app as `VITE_GRAPH_NODE_PORT` through
`vite.config.ts`. `packages/core` uses it only for a chain whose default endpoint is a local
graph-node; both defaults are Studio deployments today, so to read the local node from
`pnpm graph:up`, set the two `VITE_SUBGRAPH_URL_` variables to its URLs.

The release build ignores the other shell settings and .env files. It reads [`build.env`](build.env) plus the explicit `VITE_GRAPH_API_KEY` environment input; see
[Deployment](#deployment).

## Scripts

| Script | What it does |
|--------|--------------|
| `dev` | Vite dev server |
| `build` | `tsc -b`, then the production build into `dist/` |
| `preview` | Serves `dist/` |
| `lint` | ESLint |
| `check` | `codegen:check`, `i18n:check`, ESLint, `tsc -b --noEmit`, and the e2e TypeScript project. Also run by the root `pnpm check` |
| `test` | Vitest, once: the tests under `src/` and `scripts/` |
| `test:watch`, `test:coverage` | Vitest in watch mode, and with a coverage report |
| `test:e2e` | Playwright against mocked RPC, `e2e/tests/` |
| `test:e2e:ui`, `test:e2e:headed` | The same suite in Playwright's UI, or in a visible browser |
| `test:fork` | Playwright against the real contracts on an Anvil Mainnet fork, `e2e/fork/`; see [Fork suite](#fork-suite) |
| `test:smoke:web` | Playwright against the production deployment at `PRODUCTION_URL`, `e2e/smoke/`; see [Production smoke suite](#production-smoke-suite) |
| `availability` | Checks that the production deployment, and the gateways for the latest release in the root `deployments.json`, serve the interface; needs `PRODUCTION_URL` |
| `fork:up`, `fork:reset`, `fork:down` | The manual QA fork for Claim & Stake; see [`docs/manual-qa-fork.md`](../../docs/manual-qa-fork.md) |
| `codegen` | Regenerates the typed GraphQL in `src/graphql/<chain>/generated.ts` from each subgraph package's `schema.graphql` |
| `codegen:check` | Fails when the committed GraphQL types differ from a fresh `codegen` |
| `codegen:live-check` | Validates the GraphQL documents against a running graph-node, the Studio deployments by default |
| `i18n:extract` | Writes the English catalogue, `src/i18n/locales/en.json`, from the keys and English in `src/`; see [`docs/translations.md`](../../docs/translations.md) |
| `i18n:check` | Writes nothing; fails when a catalogue misses a key, keeps an unused one, or changes a placeholder |
| `generate:proofs` | Builds a reward Merkle tree and its files; see [Reward proofs](#reward-proofs) |
| `release:build` | The reproducible production build from `build.env`, packed into `release/app.car` with its root CID in `release/CID`; see [Deployment](#deployment) |
| `release:pin` | Pins `release/app.car` to Pinata and checks that the gateways serve it |
| `budget:bundle` | Checks a built `dist/` against the bundle limits in `performance-budget.json`; `release:build` runs it |
| `budget:lighthouse` | Lighthouse mobile on a built `dist/`, three runs per route, checked against the rest of the budget; see [`PERFORMANCE.md`](./PERFORMANCE.md) |

The root also has `pnpm test:e2e`, `pnpm test:fork`, `pnpm test:smoke:web`, `pnpm fork:up`, `pnpm fork:reset` and
`pnpm fork:down`, which run the same scripts.

See [`MANUAL_TESTING.md`](./MANUAL_TESTING.md) for the pre-release manual checklist.

## Tests

- **Unit**: Vitest with jsdom, `pnpm --filter @cobuilders/safenet-web test`. Tests sit next to
  the code in `src/**/__tests__/` and `scripts/__tests__/`.
- **End-to-end**: Playwright, `pnpm --filter @cobuilders/safenet-web test:e2e`. It starts its
  own Vite on `E2E_PORT` (5174 without `.env.ports`), and outside CI reuses a server already
  listening there. An injected test wallet answers from a mocked RPC, and the subgraphs, SEF's
  files and the gateways are mocked too, so the suite needs no network and no secret. It proves
  the interface behaves, not that a transaction works. WalletConnect is only smoke-tested there.
  For the Safe App, two tests frame the app from another origin. One checks that it takes the
  Safe connector path: the Connect control is hidden, and the app asks its parent for the Safe's
  details with the Safe Apps SDK's `getSafeInfo`. The other has the parent answer 15 ms late and
  checks that the Safe it names becomes the connected account. They prove the app's side, not that
  Safe{Wallet} answers, and no transaction goes through a Safe.
  `e2e/tests/accessibility.spec.ts` runs axe against WCAG 2.2 AA on every route;
  see [`ACCESSIBILITY.md`](./ACCESSIBILITY.md).
- **Fork**: below.
- **Production smoke**: below.

### Fork suite

`pnpm test:fork` drives the same interface against the real contracts: Anvil forks Mainnet at a
pinned block, the injected test wallet forwards every call to Anvil, and each test reads the chain
after the UI action to prove the transaction did what the screen says.

It covers approve then stake, initiating a withdrawal, claiming one after the cooldown (the
chain's clock is moved forward, and the page's clock with it), and claiming rewards with SEF's
real proof as an impersonated address. Each test runs inside an Anvil snapshot that is reverted
after it.

```bash
pnpm env:pull                                        # once: writes MAINNET_RPC_URL to the root .env.local
pnpm --filter @cobuilders/safenet-web test:fork
```

- **Needs** Foundry (`anvil` on the `PATH`) and `MAINNET_RPC_URL`, an archive endpoint, in the
  environment or the root `.env.local`. Public endpoints are not a fallback: they cannot serve
  state at a pinned block.
- **Ports** come from the root `.env.ports`: `ANVIL_PORT` for Anvil, `FORK_PORT` for the web
  server. Without the file, 8545 and 5178.
- **The pin** is `MAINNET_FORK` in `packages/core/src/fork.ts`: a block and the commit of SEF's
  data repository from the same moment. Move them together, or the reward proofs stop matching
  the root on chain.
- **Anvil** starts and stops with the run, pass or fail. Its output is shown with URLs redacted.
- **The fork URL is on Anvil's command line**, because Anvil reads it from no environment
  variable. On a shared machine, anyone who can list processes can read the URL, key included,
  while the suite runs.

CI runs it nightly, not on pull requests, because every run reads from the archive node.

### Production smoke suite

`pnpm test:smoke:web`, from the root or here, opens the production deployment as a visitor
without a wallet sees it. Nothing is mocked: every figure comes from the RPC, the subgraphs and
SEF's files the deployment reads.

```bash
PRODUCTION_URL=<the production deployment> pnpm --filter @cobuilders/safenet-web test:smoke:web
```

It checks that the index answers with the title, that the Overview shows a total staked figure
and not "Unavailable", that the validators list shows at least one validator, that the Rewards
page shows the Programme section without its load error, and that `manifest.json` carries `name`,
`description` and an `iconPath` that answers as an image.

- **Needs** `PRODUCTION_URL`. It has no default, because it is deployment configuration, not a
  constant: in GitHub Actions it is a repository variable. The suite fails with a message when
  it is unset.
- **Proves** that the deployment works today for a reader. It sends no transaction.

CI runs it nightly in `nightly.yml`, job `web-smoke`, and alone through a manual run of the
Nightly workflow with `suite: web-smoke`.

## Tech stack

- React 19 and TypeScript
- Vite 7 and Tailwind CSS 4
- wagmi 3 and viem
- TanStack Query
- React Router 7, hash-based routing
- Radix UI primitives styled after shadcn/ui
- graphql-request with GraphQL Code Generator
- Recharts
- i18next with react-i18next
- Vitest and Playwright

## Layout

```
src/
├── assets/       images bundled with the app
├── components/   dashboard, layout, overview, rewards, staking, ui, validators, wallet, withdrawals
├── config/       chain and transports, contract addresses, wagmi, QueryClient, subgraph endpoints
├── graphql/      GraphQL documents per chain and their generated types
├── hooks/        contract reads and writes, subgraph queries, rewards, compliance checks
├── i18n/         languages, detection, and the catalogues in locales/
├── lib/          formatting, errors, figures, programme copy, restriction copy, Safe detection
└── pages/        one component per route
e2e/
├── tests/        the mocked suite
├── fork/         the fork suite
├── mocks/        mocked RPC, event logs and subgraphs
├── fixtures/     Playwright fixtures and test data
└── pages/        page objects
scripts/
├── merkle-tree.ts, generate-merkle-tree.ts, merkle-config.json   reward proofs
├── fork-env/     the manual QA fork behind fork:up, fork:reset and fork:down
├── codegen-check.ts, codegen-live-check.ts, subgraph-api-schema.ts   GraphQL codegen
├── release.ts, release-pin.ts   the IPFS release, over packages/snapshots' IPFS module
└── i18n-extract.ts, i18n-catalogues.ts   the catalogue extraction and check
public/           static files, including the Safe App manifest
```

Every ABI comes from `packages/core`, where `pnpm verify:abis` checks each function, event and
error against the deployed contracts. The interface keeps no copy of its own.

## Wallets

`src/config/wagmi.ts` configures one chain, Mainnet, and these connectors:

1. **Safe**, `safe()`. Inside a Safe{Wallet} iframe, `useAutoConnect` connects it on load, so a
   Safe App always uses the Safe, not the last wallet used. The connector waits
   `SAFE_INFO_TIMEOUT_MS` (`src/lib/safe.ts`), two seconds, for Safe{Wallet}'s first answer, not
   wagmi's default of 10 ms, which a loading or slow Safe{Wallet} misses.
2. **Browser Wallet**, `injected()` on `window.ethereum`: MetaMask, Rabby and other extensions.
3. **WalletConnect**, only when `VITE_WALLETCONNECT_PROJECT_ID` is set.

A wallet on another chain sees a "Wrong network" notice on every page, with Switch to Ethereum
when the wallet can switch from here, and every action that sends a transaction stops. The figures
stay: the interface reads Ethereum through its own RPC, not through the wallet.

When the wallet supports EIP-5792 atomic batching, as a Safe does, approve and stake go out as
one batch, and two or more ready withdrawals can be claimed with one Claim All.

The interface says Delegate and Undelegate; the contract and the hooks say stake
(`stake()`, `initiateWithdrawal()`, `claimWithdrawal()`).

## Compliance gates

Each gate fails closed. The restricted screen names the gate that closed the app, says whether it
refused or could not answer, and offers what the visitor can do: Reload or Try again after a
failed check, Disconnect wallet for a wallet. `MANUAL_TESTING.md` has the states of every screen.

- `useGeoblockCheck` looks up the visitor's country and blocks the app with "Access Restricted",
  naming the country, for the countries listed in `src/hooks/useGeoblockCheck.ts`. A failed
  lookup shows "Access Check Failed".
- `useSanctionsCheck` blocks the app when `VITE_SANCTIONS_API_URL` is set: "Access Restricted" on
  a 403, "Access Check Failed" when the request fails.
- `useWalletSanctionsCheck` asks the sanctions oracle named in `packages/core` about the
  connected address. It shows "Wallet Restricted" when the oracle lists it, and "Wallet Check
  Failed" when the read fails; only an explicit no opens the app.

## Where reward data comes from

SEF names the IPFS dataset behind the ENS name `SEF_REWARDS_ENS_NAME` in
`packages/core/src/rewards-source.ts` the canonical source of reward data, and keeps its data
repository as a temporary mirror. The interface reads `latest.json` and each proof in this order,
and the first source that answers wins:

1. `VITE_REWARDS_BASE_URL`, when set. It replaces every other source; the manual QA fork and the
   fork suite use it.
2. SEF's dataset through each IPFS gateway, `VITE_IPFS_GATEWAY` first and then `IPFS_GATEWAYS`
   in `packages/core`, but only when the name's contenthash is set. The gateways share one
   10-second budget, and each in turn gets the time left divided by the gateways left.
3. The repository mirror, `SEF_DATA` in `packages/core`.

A source that fails, answers 404, serves a file of the wrong shape or does not answer in time
falls through to the next. A gateway's 404 proves nothing: an address has no proof only when the
repository, or the override, answers 404. The name is resolved through its own resolver once an
hour per session, and again after a minute when the chain could not be read. When the
contenthash is empty, the interface reads the repository; when SEF sets it, the interface reads
the dataset with no new deploy.

The Verifiability section of the Rewards page names the source of `latest.json`, and the gateway
it came through, or why the repository was read. When the repository's 404 settles that an
address has no proof while the dataset did not answer, Your rewards adds that this rests on the
mirror.

SEF's `latest.json` carries `epoch`, `merkleRoot`, `rewardsUntil`, `tokenTotal` and
`unpaidAmount`. From the first Aegis file, rewardsUntil 2026-10-27, it also carries
`sentinelTokenTotal`, the part of `tokenTotal` paid to sentinels. SEF does not document it.

## Reward proofs

`scripts/generate-merkle-tree.ts` builds the files SEF publishes, for a test environment:

1. Edit `scripts/merkle-config.json`: an epoch and each address's cumulative reward in wei.
   ```json
   {
     "epoch": 1,
     "entries": {
       "0xWalletAddress": "1000000000000000000000"
     },
     "rewardsUntil": "2026-01-01T00:00:00.000Z",
     "unpaidAmount": "0"
   }
   ```
   `rewardsUntil` (ISO 8601) and `unpaidAmount` (wei) are optional; they default to the time of
   the run and `"0"`.
2. Run `pnpm --filter @cobuilders/safenet-web generate:proofs`. It writes to `apps/web/.rewards/`,
   which git ignores; `--out <dir>` names another directory.
3. The output is `proofs/<radix>/<lowercase address>.json` for each address and `latest.json`
   with `epoch`, `merkleRoot`, `rewardsUntil`, `tokenTotal` and `unpaidAmount`, the five fields
   SEF publishes.
4. Serve the directory and point `VITE_REWARDS_BASE_URL` at it.
5. Then set the MerkleDrop's root to the generated one. In the other order the app serves the old
   proofs against the new root, and Claim stays disabled because the roots differ. This
   repository sets a root only on an Anvil fork, as the MerkleDrop's owner, in
   `scripts/fork-env/chain.ts`.

The tree uses sorted-pair hashing, the OpenZeppelin convention, with viem for the encoding
(`scripts/merkle-tree.ts`).

## Deployment

Production is IPFS. The Release section of the [repository README](../../README.md#release)
describes the workflow, and [`VERIFY.md`](../../VERIFY.md) shows how to rebuild a release and
compare its CID.

### Build

`pnpm --filter @cobuilders/safenet-web build` writes a static site to `apps/web/dist/` with
relative asset paths and hash routing, so it works from any path on any static host or IPFS
gateway. It reads the same env as `dev`.

### Release to IPFS

```bash
pnpm --filter @cobuilders/safenet-web release:build
pnpm --filter @cobuilders/safenet-web release:pin
```

- `release:build` (`scripts/release.ts`) reads [`build.env`](build.env) plus the explicit public
  `VITE_GRAPH_API_KEY`. Every `.env` file and every other shell `VITE_` variable is ignored. That file is committed and
  public, holds only `VITE_` keys, and never a secret. The script builds in production mode,
  runs the browser-safety check over `dist/`, packs `dist/` into `release/app.car` and writes the
  root CID to `release/CID`. The packing, the Pinata upload and the gateway checks live in
  `@cobuilders/safenet-snapshots/ipfs`, which the daily snapshots publish through too. `release/` is git-ignored. Set `VITE_APP_URL` in `build.env` so that
  the social preview tags carry an absolute URL.
- `release:pin` (`scripts/release-pin.ts`) uploads the CAR to Pinata and fails if Pinata reports
  another CID. It then checks the dedicated Pinata gateway and each gateway in `IPFS_GATEWAYS`
  in `packages/core`: each must serve `index.html` and the release's smallest `.js` file byte for
  byte. It needs `PINATA_JWT` and `PINATA_GATEWAY`, from the environment or the root
  `.env.local`, and fails when either is missing. `RELEASE_NAME` and `GATEWAY_TIMEOUT_SECONDS`
  are optional.

`.github/workflows/release.yml` runs both on a `v*` tag or by hand. Its build step receives only the public browser key, mapped from `GRAPH_API_KEY` to
`VITE_GRAPH_API_KEY`; it receives no private credentials. Its pin job takes the two Pinata secrets and runs only from `main` or a `v*` tag.

### Safe App

Use **`https://safenet.cobuilders.xyz`** as the Custom Safe App URL.
In [Safe{Wallet}](https://app.safe.global), open your Ethereum Mainnet Safe, then Apps → My custom apps → Add custom app.
Enter that URL, complete Safe's acknowledgement, and open Safenet Staking.
The Safe connector connects automatically, and the header must show the Safe's address.
Follow the [manual checklist](MANUAL_TESTING.md#safe-app) to verify the connection and iframe.

`public/manifest.json` is the Safe App manifest. Safe{Wallet} reads `name`, `description` and
`iconPath`, a path relative to the app; the `icons` array and the other fields serve browsers
installing the app as a PWA. A readable manifest alone does not prove that Safe can frame the app.

The `eth.limo` gateway sends CSP `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`.
These headers block `https://app.safe.global` from embedding the app and cause the iframe's "refused to connect" error.
App code, a manifest change, or an HTML CSP cannot override these gateway response headers.
Do not use `eth.limo` or a `dweb` CID URL for this setup; the earlier dweb URL failed Safe's app check.

Vercel currently serves `https://safenet.cobuilders.xyz` without `frame-ancestors` or `X-Frame-Options` response headers.
Its manifest response permits cross-origin access, so no code or header change is needed for this setup.
Keep Vercel free of `X-Frame-Options` and any CSP that excludes `https://app.safe.global` from framing the app.
The dev and preview servers configure their own CORS and Safe-compatible `frame-ancestors` headers in `vite.config.ts`.
Those settings do not control Vercel or IPFS gateway response headers.

## License

MIT, see [LICENSE](LICENSE). The app derives from Safe Foundation's safenet-staking-ui, also
MIT; its copyright notice stays in that file.

### Shared reward history and local preview

COB-661: web and CLI/MCP use `packages/core/src/reward-periods.ts` for period boundaries,
claim-prefix validation, whole-block attribution and cumulative comparisons. The web keeps its
12-distribution limit, archive baseline, root check and explicit failure states. These rows show
claimed payments. Per-period earnings and exact same-block event ordering remain unknown.

After `pnpm build` at the repository root, run `box-preview start .` there to serve the built app
on an internal preview host through the tailnet. The committed adapter binds only to loopback and expires through
fleet preview management. It uses the build's real read endpoints; it does not inject a wallet or mocks.

Network gateway setup, exact operator settings and release reproducibility: [GRAPH-GATEWAY.md](../../GRAPH-GATEWAY.md).
