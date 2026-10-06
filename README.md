# safenet-staking

[![Parity with SEF](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml/badge.svg)](https://github.com/CoBuilders-xyz/safenet-staking/actions/workflows/parity.yml)

Mainnet total staked compared to the wei against SEF's published figure at its publish instant,
daily. Gnosis participation is not comparable on Studio until the subgraph keeps hourly buckets
with completion semantics.

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

## MCP server

`packages/mcp` is `safenet-mcp`, an MCP server over stdio that gives an AI client the reads of
the `safenet` command-line interface, one tool per command. Its write tools return dry runs
unless the operator allows writes when the server starts.

- [packages/mcp/README.md](packages/mcp/README.md): the tools and their arguments, the settings,
  and how to add the server to Claude Desktop and Cursor.
- [packages/mcp/CLAUDE.md](packages/mcp/CLAUDE.md): how it is built and tested.
