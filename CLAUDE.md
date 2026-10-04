# CLAUDE.md — safenet-staking

A pnpm and Turborepo monorepo. `apps/web` is the Safenet Beta staking interface.
`packages/subgraph-mainnet` and `packages/subgraph-gnosis` index the Safenet contracts on each
chain. `packages/core` holds the constants all of them read.

The authoritative in-repo sources are `packages/core` for every address, start block and ABI, and
`pnpm metrics` for the numbers.

## Non-negotiables

**Never type a hex address, a start block, or an event signature anywhere except
`packages/core`.** Import them. This is the single rule that keeps agents from hallucinating
constants that look plausible and are wrong.

**No source file is authoritative for ABIs. Only the chain is.** The deployed Safenet contracts
match neither published branch of `safe-research/safenet`. If `verify:abis` fails, do not "fix"
a signature by reading a git branch. Recover the real signature from the chain.

**State inferences as inferences.** If you have not verified something against a primary source,
say so. Code comments, documentation and git branches go stale. The chain and SEF's published
data are the primary sources.

## Commands

Every package implements the same five. Turborepo fans them out.

| Verb | What it does |
|---|---|
| `pnpm bootstrap` | Runs `scripts/setup.sh`: checks tools, writes `.env.ports`, installs, then links Vercel and pulls `.env.local`. Safe to re-run. **Not `setup`: that is a pnpm builtin that edits your shell rc.** |
| `pnpm dev` | Starts the web app's Vite dev server, type-watches `packages/core`, and regenerates the subgraph manifests and types. |
| `pnpm build` | Builds all packages. |
| `pnpm test` | Unit tests. `apps/web` has 315 Vitest tests in 39 files. The subgraphs have matchstick tests: 20 in `subgraph-mainnet`, 11 in `subgraph-gnosis`. `packages/core` has 22 node:test tests in 4 files, and its script fails when it finds no test file. |
| `pnpm check` | Lint, the browser-safety check, then types in every package. Run it before every commit. |

The test counts were measured with `pnpm test` when this file was written. Run it for the
current numbers.

Scope to one package with `pnpm --filter <name> check`. The names are
`@cobuilders/safenet-core`, `@cobuilders/safenet-web`, `@cobuilders/safenet-subgraph-mainnet` and
`@cobuilders/safenet-subgraph-gnosis`.

Specific commands, only where they apply:

| Command | Where | What it proves | Today |
|---|---|---|---|
| `pnpm verify:abis` | `packages/core` | The high-frequency event signatures still match the chain, over a recent window | works |
| `pnpm verify:abis:deep` | `packages/core` | Every signature, including rare events, scanned from each deploy block | needs the archive `MAINNET_RPC_URL` from `pnpm env:pull` |
| `pnpm metrics` | `packages/core` | The 24 metrics, computed against live chains and compared with SEF's published JSON. Writes `packages/core/.metrics/`, which is git-ignored | needs an archive node. With public RPC only, it stopped on a failed Mainnet log range when this file was written |
| `pnpm check:browser` | root | `apps/web/src` reads no `process.env`, and a built bundle contains no value from `.env.local` | works, part of `check` |
| `pnpm test:e2e` | `apps/web` | The interface behaves, against mocked RPC. 73 Playwright tests in 13 spec files | runs; one navigation test is intermittently flaky |
| `pnpm test:fork` | `apps/web`, `packages/cli` | Transactions execute against real contracts on Anvil | **fails on purpose: no suite** |
| `pnpm test:parity` | subgraphs | Our numbers match SEF's published JSON | **fails on purpose: no subgraph package implements it yet** |

`turbo run <task>` with no package implementing the task reports a success while running nothing.
A green tick over a suite that does not exist is worse than a red one: a failure gets fixed, a
false pass gets believed. So `test:e2e`, `test:fork` and `test:parity` first run
`tools/require-task.mjs`, which fails unless some package implements the task. `test:e2e` passes
the guard because `apps/web` implements it. The other two fail until their suites exist. Do not
remove a guard before the real suite lands.

The e2e suite starts Vite on `E2E_PORT`, or on 5174 when it is unset, and reuses a server already
listening there. Two worktrees running the suite at once therefore share one server, and one
run fails when the other stops it. `scripts/setup.sh` writes a per-worktree `E2E_PORT` into
`.env.ports`, but the e2e suite does not load that file, and Turborepo's strict environment
mode drops the variable when you go through the root script. To isolate a run, call the package
directly: `E2E_PORT=<port> pnpm --filter @cobuilders/safenet-web test:e2e`.

## Layout

The target layout has nine packages. **Four exist on `main`.** The rest are listed so the shape is
known, not to suggest they are there:

```
apps/web                    EXISTS   the fork of safe-fndn/safenet-staking-ui, under pnpm. Vitest
                                     unit and Playwright e2e suites.
packages/core               EXISTS   addresses, start blocks, ABIs. The only source of constants.
packages/subgraph-mainnet   EXISTS   staking, withdrawals and rewards on Ethereum Mainnet
packages/subgraph-gnosis    EXISTS   consensus and signing on Gnosis Chain
tools/                      EXISTS   edit hook, task guard, browser-safety check, metrics report
scripts/setup.sh            EXISTS   what `pnpm bootstrap` runs
docker-compose.yml          EXISTS   local graph-node, postgres and ipfs
graph-node.toml             EXISTS   graph-node config for two chains at once
.github/workflows/          EXISTS   CI

apps/api                    planned  REST wrapper, Cloudflare Workers
apps/alerts                 planned  alerts service, Supabase
packages/cli                planned  safenet-cli
packages/mcp                planned  MCP server. Calls the shared library, not the CLI binary.
packages/testing            planned  shared fixtures: anvil, RPC mocks, Playwright helpers
```

Do not infer that a planned package exists because this file names it. Check.

`packages/core` and `apps/web` each own a `CLAUDE.md`; the subgraph packages do not. Read the one
for the package you are in, not all of them. `apps/web/CLAUDE.md` came with the fork and names
`yarn`. This repository uses pnpm, so run its scripts as
`pnpm --filter @cobuilders/safenet-web <script>`.

## Subgraphs

A subgraph manifest carries contract addresses and start blocks, and its ABI files carry event
signatures. So neither is written by hand. `pnpm generate` in each subgraph package writes
`subgraph.yaml` and `abis/` from `packages/core`, and both are git-ignored. `dev`, `build` and
`test` run it first.

`pnpm test` runs the matchstick tests, which feed hand-built events to the handlers and need no
chain. Each package also has a `differential` script. The Mainnet one compares a locally indexed
subgraph with the contracts read directly; the Gnosis one compares it with a `pnpm metrics` run.
Both need a running graph-node: `pnpm graph:up` starts graph-node, postgres and ipfs through
Docker Compose, with ports from `.env.ports` and the archive RPC from `.env.local`.
`pnpm graph:down` stops them and discards the indexed data.

## Continuous integration

`.github/workflows/ci.yml` runs four jobs on every pull request and on every push to `main`:
`check`, `test`, `e2e` and `verify-abis`. `nightly.yml` runs the deep ABI scan and the unit tests
daily; the deep scan needs the `MAINNET_RPC_URL` secret. `security.yml` runs a
dependency review on pull requests, skipped until the repository is public, and `pnpm audit`
weekly.

## What happens when you edit

`.claude/settings.json` runs `tools/hook-check.mjs` after every Edit or Write. For a TypeScript
file it runs ESLint with `--fix` on that file, which warns but never blocks. Then it type-checks
that file's package, which **does** block. A type error means an assumption is wrong, so stop and
fix it rather than working around it.

## Feedback loops

| When | What runs | Budget |
|---|---|---|
| After each edit | Lint the file, type-check its package | seconds |
| Before each commit | `pnpm check` | seconds |
| Every pull request | CI: `check`, `test`, `e2e`, `verify-abis` | minutes |

## Secrets

Secrets live in the Vercel project. `pnpm env:pull` writes them to `.env.local` at the repository
root. `pnpm bootstrap` runs it when the Vercel CLI is signed in. Git ignores the file. If you
need a credential, read it from the environment. Never print one, and never write one into a file
that is not `.env.local`.
