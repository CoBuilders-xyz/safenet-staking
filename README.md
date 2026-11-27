# safenet-staking

The tools CoBuilders builds for staking on Safenet: the web interface for staking SAFE to Safenet
validators, two subgraphs that index the Safenet contracts on Ethereum Mainnet and Gnosis Chain,
the `safenet` command-line interface, an MCP server, a validator REST API, a wallet-authenticated
alerts service, and dated IPFS snapshots.
They share one package of constants, so every address, start block and ABI is written once.

[![Parity with SEF](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml/badge.svg)](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml)
[![Availability](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/availability.yml/badge.svg)](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/availability.yml)

Each day, the Studio deployments named in `packages/core/src/subgraphs.ts` are compared with
SEF's published figures at their publish instant: the Mainnet staked total to the wei, and each
validator's Gnosis participation rate as the identical double.

Every six hours, the production deployment is checked: it answers with the interface's title and
serves the entry script of its build. The ENS name must serve the same `index.html`. Each public
IPFS gateway in `packages/core` must serve the CID that the ENS name serves. The validator API and
the alerts Worker must report healthy. An isolated Orbitor HTTP 504 is a visible
warning only when every other check passes. All other
failures block. Release pin verification remains strict. A red nightly, parity, availability or uptime export
run opens an issue labelled `ci-red`, or comments on the open one.

## Layout

- [`apps/web`](apps/web): the staking interface, a React app that also runs as a Safe App. Its
  [README](apps/web/README.md) goes from a fresh clone to a running app and its tests.
- [`apps/api`](apps/api): six REST endpoints: four validator routes, health and system stats; HTTP smoke/load tools.
- [`apps/alerts`](apps/alerts): signed subscriptions, a poller, Telegram and Web Push delivery.
- [`packages/core`](packages/core): the addresses, start blocks, ABIs and other constants every
  other package reads.
- [`packages/cli`](packages/cli): `safenet`, the command-line interface, with read commands and
  write commands that support `--dry-run`.
- [`packages/mcp`](packages/mcp): `safenet-mcp`, the MCP server.
- [`packages/subgraph-mainnet`](packages/subgraph-mainnet): staking, withdrawals and rewards on
  Ethereum Mainnet.
- [`packages/subgraph-gnosis`](packages/subgraph-gnosis): consensus and signing on Gnosis Chain.
- [`packages/snapshots`](packages/snapshots): the daily snapshot of the full validator dataset on
  IPFS, indexed by date, and the IPFS path the release shares with it.
- [`tools`](tools): repository scripts: the edit hook, the task guard, the browser-safety check,
  the metrics report, the Studio deploy, and the runner for their tests.

The API and Alerts Workers require separate deployment and operator configuration. Their presence
in this tree does not establish that either service is live.

See the [operational runbook](docs/RUNBOOK.md) for monitoring, incident triage, recovery and delivery evidence.

## Safe App

Use **`https://safenet.cobuilders.xyz`** as the Custom Safe App URL in [Safe{Wallet}](https://app.safe.global).
Open your Ethereum Mainnet Safe, select Apps, then My custom apps, and add that URL.
Open Safenet Staking and check that the header shows your Safe's address.

The `eth.limo` gateway blocks the Safe iframe with CSP `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`.
App code cannot override these gateway response headers.
Do not use `eth.limo` or a `dweb` CID URL for this setup; the earlier dweb URL failed Safe's app check.
Vercel currently serves the custom app without these iframe restrictions.
See the [Safe App guide](apps/web/README.md#safe-app) and [manual verification](apps/web/MANUAL_TESTING.md#safe-app).

## Setup

Use the Node version in `.nvmrc` and pnpm.

```sh
pnpm bootstrap       # prepares this worktree: tools, dependencies, browser, secrets
pnpm link:services   # links this worktree to the Vercel project
pnpm env:pull        # pulls the development secrets into .env.local
```

`pnpm bootstrap` runs the last two by itself when the Vercel CLI is signed in. Otherwise,
run `vercel login`, then run them.

Secrets never live in the repository. They come from Vercel into `.env.local` at the
repository root, which git ignores. The Node scripts read that file, and so does Vite for
`pnpm dev` and `pnpm build`. Vite puts only `VITE_` values into the bundle.

## Commands

Every package implements the same five. Turborepo fans them out.

| Command | What it does |
|---|---|
| `pnpm bootstrap` | Prepares everything. Safe to re-run. |
| `pnpm dev` | Starts the local stack. |
| `pnpm build` | Builds all packages. |
| `pnpm test` | Unit tests. |
| `pnpm check` | Lint and types. |

`pnpm fork:up` starts the manual QA fork for Claim & Stake, the interface on an Anvil fork of
Mainnet with a funded test account: [docs/manual-qa-fork.md](docs/manual-qa-fork.md).

## CLI wallets

Install `@cobuilders/safenet-cli`; run the `safenet` executable.
For WalletConnect, pass `--walletconnect --wallet-account <address>` in an interactive terminal.
Type `connect` to display the pairing QR and URI on stderr. Keep both private.
The built-in project ID is `f35bb4d915df109f8006841b674b5604`; `WALLETCONNECT_PROJECT_ID` optionally overrides it.

**The wallet signs and broadcasts through its own RPC.** The CLI validates the returned hash and polls receipts.
It verifies the mined call before confirming a step or continuing. Failed verification stops subsequent steps.
Cancellation or timeout cannot stop a pending wallet request. Check wallet activity before retrying.
See [CLI signing](packages/cli/README.md#signing) for details.

## MCP server

`packages/mcp` is `safenet-mcp`, an MCP server over stdio that gives an AI client the reads of
the `safenet` command-line interface, one tool per command. Its write tools return dry runs
unless the operator allows writes when the server starts.

- [packages/mcp/README.md](packages/mcp/README.md): the tools and their arguments, the settings,
  and how to add the server to Claude Desktop and Cursor.
- [packages/mcp/CLAUDE.md](packages/mcp/CLAUDE.md): how it is built and tested.

## npm CLI and MCP beta

The in-repo version is `0.1.0-beta.3`.
Install published betas with `@beta`.
Publishing uses GitHub Actions OIDC Trusted Publishing, with no permanent npm token.
Both packages already have Trusted Publishers configured for `publish.yml`.
Publishing beta.3 updates the `beta` tag; it does not change `latest`.
See [RELEASING.md](RELEASING.md#publish-the-cli-and-the-mcp-server) for releases, dry-run checks and tag cleanup.

## Release

Production is the ENS name `safenet.cobuilders.eth` and the Vercel production domain, and both
serve one build. [RELEASING.md](RELEASING.md) is the operator page for every release: a draft
GitHub Release from *Create draft release*, then its publication, which runs the project's own
workflow. A web release builds the interface from `apps/web/build.env` and the injected public
`VITE_GRAPH_API_KEY`, packs it into a CAR, pins it to Pinata, checks the gateways, runs the
production smoke on the new CID, then points the ENS name at it and moves the Vercel production
domain to the same files.

The build step receives only the intentionally public Graph gateway key (COB-566).
Private credentials remain excluded. Configure subgraph restrictions and a USD 20/month spending cap before building.
The bundle scan runs only when `.env.local` and the built bundle exist. It checks non-`VITE_` values longer than 12 characters,
excluding public values from `build.env`. The `GRAPH_API_KEY` entry is also exempt when it matches the explicit
`VITE_GRAPH_API_KEY`; other private entries remain checked even if they share that value. It does not detect every possible secret.

The CID depends on the source, lockfile, `build.env` and the public gateway key.
[`VERIFY.md`](VERIFY.md) explains reproduction; [GRAPH-GATEWAY.md](GRAPH-GATEWAY.md) lists operator settings.

```sh
pnpm --filter @cobuilders/safenet-web release:build   # writes apps/web/release/CID and app.car
pnpm --filter @cobuilders/safenet-web release:pin     # needs PINATA_JWT
```

### Status page and uptime

The Availability workflow, every six hours, reads the CID production serves from the ENS name:
eth.limo's `x-ipfs-roots` header. It also checks that the ENS name and Vercel serve the same
`index.html`. A release therefore needs no record in the repository. To find an earlier
release's CID, rebuild its tag as [`VERIFY.md`](VERIFY.md) shows: the same commit gives the same CID.

The public status page runs Gatus, one check every one to five minutes for each production
service. [`ops/status/README.md`](ops/status/README.md) lists the checks and the deploy, and
explains the weekly uptime export.


## Daily snapshots

Each day, `.github/workflows/snapshots.yml` pins a snapshot of the full validator dataset to IPFS:
state, history and events, every figure read at one Mainnet block, one Gnosis block and SEF's
latest commits. The index of CIDs by date is `index.json` on the orphan branch `snapshots`.
Anyone can re-derive a snapshot's CID from its files with `pnpm snapshot:verify <CID>`.
[`packages/snapshots/README.md`](packages/snapshots/README.md) has the schema and the caveats.

## License

This repository is released under the MIT License, see [LICENSE](LICENSE). `apps/web` derives
from Safe Foundation's [safenet-staking-ui](https://github.com/safe-fndn/safenet-staking-ui),
which is also MIT. Its copyright notice stays in [apps/web/LICENSE](apps/web/LICENSE), as the
MIT License requires.
