# safenet-staking

[![Parity with SEF](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml/badge.svg)](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml)

Each day, the Studio deployments named in `packages/core/src/subgraphs.ts` are compared with
SEF's published figures at their publish instant: the Mainnet staked total to the wei, and each
validator's Gnosis participation rate as the identical double.

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
interface from the committed public values in `apps/web/build.env`, fails if the bundle holds
a secret, packs it into a CAR and pins that CAR to Pinata. Then it checks that the dedicated
Pinata gateway and each public gateway in `packages/core` serve it.

The CID depends only on the source, the lockfile and `build.env`, so anyone can rebuild it
and compare. [`VERIFY.md`](VERIFY.md) has the exact commands.

```sh
pnpm --filter @cobuilders/safenet-web release:build   # writes apps/web/release/CID and app.car
pnpm --filter @cobuilders/safenet-web release:pin     # needs PINATA_JWT and PINATA_GATEWAY
```

## License

This repository is released under the MIT License, see [LICENSE](LICENSE). `apps/web` derives
from Safe Foundation's [safenet-staking-ui](https://github.com/safe-fndn/safenet-staking-ui),
which is also MIT. Its copyright notice stays in [apps/web/LICENSE](apps/web/LICENSE), as the
MIT License requires.
