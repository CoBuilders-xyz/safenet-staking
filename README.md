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
serves the entry script of its build. Once a release is recorded in `deployments.json`, each
public IPFS gateway in `packages/core` is checked too. An isolated Orbitor HTTP 504 is a visible
warning only when production HTML, production JavaScript and every other gateway pass. All other
failures block. Release pin verification remains strict. A red nightly, parity or availability
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

## MCP server

`packages/mcp` is `safenet-mcp`, an MCP server over stdio that gives an AI client the reads of
the `safenet` command-line interface, one tool per command. Its write tools return dry runs
unless the operator allows writes when the server starts.

- [packages/mcp/README.md](packages/mcp/README.md): the tools and their arguments, the settings,
  and how to add the server to Claude Desktop and Cursor.
- [packages/mcp/CLAUDE.md](packages/mcp/CLAUDE.md): how it is built and tested.

## Release

Production is IPFS. Vercel serves previews only.

A release is a tag `v*`, or a manual run of the `Release` workflow. The workflow builds the
interface from the committed public values in `apps/web/build.env`, packs it into a CAR and
pins that CAR to Pinata. Then it checks that the dedicated Pinata gateway and each public
gateway in `packages/core` serve it.

A manual run has a boolean input `pin`, on by default. With `pin` off, the workflow builds,
records the CID and uploads the CAR as an artifact, and pins nothing. The pin job also refuses
any ref other than `main` or a `v*` tag, so a manual run from another branch never pins.

The build job receives no secret, so none can reach the bundle. That is the guarantee in CI.
The browser-safety check also runs there, but its bundle half compares the build with
`.env.local`, which the runner does not have, so it finds nothing to compare. On a developer
machine with `.env.local`, it fails the release build when a secret reaches the bundle.

The CID depends only on the source, the lockfile and `build.env`, so anyone can rebuild it
and compare. [`VERIFY.md`](VERIFY.md) has the exact commands.

```sh
pnpm --filter @cobuilders/safenet-web release:build   # writes apps/web/release/CID and app.car
pnpm --filter @cobuilders/safenet-web release:pin     # needs PINATA_JWT and PINATA_GATEWAY
```

### deployments.json

`deployments.json` at the repository root records each pinned release, so the availability check
knows which CID the gateways must serve. Nothing in the repository writes it: after `release:pin`
succeeds, whoever ran the release adds the entry by hand, in a pull request. It is a JSON array,
one object per release:

```json
[
  { "cid": "bafy…", "tag": "v1.0.0", "pinnedAt": "2026-11-02T10:00:00Z" }
]
```

- `cid`: the root CID that `release:build` wrote to `apps/web/release/CID` and Pinata confirmed.
  Rebuild it as `VERIFY.md` shows before recording it: the same commit gives the same CID.
- `tag`: the git tag of the release. A manual run without a tag records the branch and the
  commit it built, as `main@<short sha>`.
- `pinnedAt`: when the pin was confirmed, ISO 8601, in UTC. When only the release run is known,
  the time that run ended.

The check reads the entry with the latest `pinnedAt`, not the last one in the file. It fails
when an entry lacks a field, when `cid` is not a CID, or when `pinnedAt` is not a date, and a
unit test reads the committed file so a bad edit fails its pull request first. Without the file,
it checks no gateway and says so in its summary.

The record names no ENS name. The interface's ENS name is recorded here only once its
contenthash points at a recorded CID on chain.

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
