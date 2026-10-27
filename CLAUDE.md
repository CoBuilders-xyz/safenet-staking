# CLAUDE.md — safenet-staking

A pnpm and Turborepo monorepo. `apps/web` is the Safenet staking interface.
`packages/subgraph-mainnet` and `packages/subgraph-gnosis` index the Safenet contracts on each
chain. `packages/core` holds the constants all of them read.

The authoritative in-repo sources are `packages/core` for every address, start block and ABI, and
`pnpm metrics` for the numbers.

## Non-negotiables

**Never type a hex address, a start block, an event signature, or a programme date anywhere
except `packages/core`.** Import them. This is the single rule that keeps agents from hallucinating
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
| `pnpm test` | Unit tests: Vitest in `apps/web`, matchstick in both subgraphs, node:test in `packages/core`, `packages/cli` and `packages/mcp`, and node:test for the root `tools/` through `test:tools`. The `packages/core` tests live under `src` and `scripts`, and its script fails when it finds no test file. `packages/cli` also has Mainnet smoke tests and fork tests that skip here, and `packages/mcp` Mainnet smoke tests; see `test:smoke` and `test:fork`. |
| `pnpm check` | Lint, the browser-safety check, then each package's check. In `apps/web` that first fails if the committed GraphQL types differ from a fresh `pnpm codegen`, then lints and type-checks. Run it before every commit. |

This file gives no test counts, because they change with every pull request. Run the suite for
the current count.

Scope to one package with `pnpm --filter <name> check`. The names are
`@cobuilders/safenet-core`, `@cobuilders/safenet-cli`, `@cobuilders/safenet-mcp`,
`@cobuilders/safenet-web`, `@cobuilders/safenet-subgraph-mainnet` and
`@cobuilders/safenet-subgraph-gnosis`.

Specific commands, only where they apply:

| Command | Where | What it proves | Today |
|---|---|---|---|
| `pnpm verify:abis` | `packages/core` | The high-frequency event signatures still match the chain. It scans a recent window and, when an event is quiet there, widens back in doubling steps to a ceiling of about 11.5 days on Gnosis and 14 on Mainnet. It prints how many blocks ago each event was last seen, and fails only when the ceiling holds no log of it: NO MATCH when the contract emitted other logs, NO ACTIVITY when it emitted none. Since 2026-10-23, a contract of a programme that has ended, as `packages/core` records it, is scanned back from that programme's last block instead of the chain head, and matches as `match (programme ended)` | works |
| `pnpm verify:abis:deep` | `packages/core` | Every signature, including rare events, scanned from each deploy block | needs the archive `MAINNET_RPC_URL` from `pnpm env:pull` |
| `pnpm metrics` | `packages/core` | The 24 metrics, computed against live chains and compared with SEF's published JSON. Writes `packages/core/.metrics/`, which is git-ignored | needs an archive node. With public RPC only, it stopped on a failed Mainnet log range when this file was written |
| `pnpm check:browser` | root | `apps/web/src` reads no `process.env`, and a built bundle contains no value from `.env.local` other than the public `VITE_` ones | works, part of `check` |
| `pnpm test:smoke` | root, `packages/cli`, `packages/mcp` | Each of the six read commands runs against Mainnet through the real entry point; the MCP server, started over stdio, answers `status` and `validators_list` | needs the archive `MAINNET_RPC_URL`; runs nightly. Skipped, with the reason, everywhere else |
| `pnpm test:e2e` | `apps/web` | The interface behaves, against mocked RPC. Playwright | runs; one navigation test is intermittently flaky |
| `pnpm test:fork` | `apps/web`, `packages/cli` | Against the real contracts on an Anvil Mainnet fork at a pinned block, each effect checked by reading the chain. `apps/web`: the staking flows in the interface, in Playwright, about 1.5 minutes. `packages/cli`: the five write commands sent for real, then each with `--dry-run`, which must change nothing, in node:test; one of those tests needs no Anvil and also runs under `pnpm test`; about 20 seconds | needs `anvil` and the archive `MAINNET_RPC_URL`; nightly in CI |
| `pnpm fork:up`, `pnpm fork:reset`, `pnpm fork:down` | root | The manual QA fork for Claim & Stake: Anvil on a fork of Mainnet at a pinned block, a test account with SAFE in its wallet and a reward to claim under a root built from every real claimer's proof at the SEF data commit core pins, and the interface, the proofs and the RPC served on one loopback origin for a browser and MetaMask. `up` is idempotent, `reset` reverts to the baseline snapshot, `down` stops only what `up` started. The guide is `docs/manual-qa-fork.md` | works; needs `anvil` and the archive `MAINNET_RPC_URL` |
| `deploy:studio` | each subgraph package, through `pnpm --filter` | The subgraph builds and Studio accepts it as a new version under its slug. Not that it syncs: watch it by deployment hash, then run `differential` with `SUBGRAPH_URL` | works; needs `GRAPH_DEPLOY_KEY` |
| `release:build` | `apps/web`, through `pnpm --filter` | The production bundle builds from `apps/web/build.env` alone, passes the browser-safety check, and packs into `apps/web/release/app.car` with its root CID in `apps/web/release/CID`. Two clean builds give the same CID; `VERIFY.md` has the steps | works; needs no secret |
| `release:pin` | `apps/web`, through `pnpm --filter` | Pinata stores the CAR under the same CID, and each gateway answers 200 for `index.html` and serves one `.js` file of the release byte for byte | needs `PINATA_JWT` and `PINATA_GATEWAY`, and fails when either is empty. Not yet run against Pinata |
| `pnpm test:parity` | both subgraph packages | Our deployed subgraphs agree with SEF's published JSON at the instant SEF published it, the commit that last wrote each file: the Mainnet staked total to the wei, and each validator's Gnosis participation rate as the identical double. Four states per chain: PASS, exit 0; FAIL, exit 1, for a real difference, a broken or lagging subgraph, SEF's data over 24 hours old, or an error; STALE, exit 0, when SEF's file is over 9 hours old; NOT COMPARABLE, exit 0, when our deployment cannot answer at SEF's instant. Subgraph URLs from `SUBGRAPH_URL_MAINNET` and `SUBGRAPH_URL_GNOSIS`, else the defaults in `packages/core`, the Studio deployment of each chain | Both pass against Studio. Gnosis sums hourly buckets filed by the attestation block from a current query, so Studio keeping about 1,000 blocks of history does not matter; a deployment without the buckets is NOT COMPARABLE. Daily in `parity.yml`, which also fails when a chain wrote no state |

`turbo run <task>` with no package implementing the task reports a success while running nothing.
A green tick over a suite that does not exist is worse than a red one: a failure gets fixed, a
false pass gets believed. So `test:e2e` first runs `tools/require-task.mjs`, which fails unless
some package implements the task; it passes because `apps/web` implements it. Put the same guard
in front of any new root task before its first suite lands, and remove it only once the real
suite exists, as `test:parity` did when both subgraph packages implemented it.

`scripts/setup.sh` writes per-worktree ports into `.env.ports` at the repository root, so two
worktrees can run the same thing at once. The e2e suite starts Vite on `E2E_PORT` and, outside CI,
reuses a server already listening there; `apps/web/e2e/ports.ts` reads `E2E_PORT` from
`.env.ports`, so the port holds from the root and from inside `apps/web`. The web fork suite
starts Anvil on `ANVIL_PORT` and its own Vite on `FORK_PORT`, and never reuses either. The CLI fork
suite starts its own Anvil on `CLI_ANVIL_PORT`, so both suites can run at once. `pnpm dev` reads
`WEB_PORT` the same way, in `apps/web/vite.config.ts`, and the subgraph `differential` scripts
read `GRAPH_NODE_PORT`. A value exported in the shell wins over the file, and `turbo.json`
passes `E2E_PORT` and `WEB_PORT` through Turborepo's strict environment mode, and `ANVIL_PORT`,
`CLI_ANVIL_PORT`, `FORK_PORT` and `MAINNET_RPC_URL` for `test:fork`. The manual QA fork reads
`QA_ANVIL_PORT`, `QA_WEB_PORT` and `QA_PROXY_PORT` the same way, in
`apps/web/scripts/fork-env/settings.ts`, and runs through `pnpm --filter`, not Turborepo. Without
`.env.ports`, as in CI, the e2e suite uses 5174, the web fork suite 5178 and Anvil 8545, the CLI
fork suite Anvil 8546, the manual QA fork 8547, 5179 and 5180, and `pnpm dev` uses Vite's default.

## Layout

The target layout has nine packages. **Six exist on `main`.** The rest are listed so the shape is
known, not to suggest they are there:

```
apps/web                    EXISTS   the fork of safe-fndn/safenet-staking-ui, under pnpm. Vitest
                                     unit and Playwright e2e suites.
packages/core               EXISTS   addresses, start blocks, ABIs. The only source of constants.
packages/subgraph-mainnet   EXISTS   staking, withdrawals and rewards on Ethereum Mainnet
packages/subgraph-gnosis    EXISTS   consensus and signing on Gnosis Chain
packages/cli                EXISTS   safenet-cli: the `safenet` binary, six read commands and five
                                     writes with --dry-run, over a library in src/lib/ that the MCP
                                     server imports
packages/mcp                EXISTS   safenet-mcp: an MCP server over stdio, one tool per CLI command.
                                     Calls the shared library, not the CLI binary. Writes are dry
                                     runs unless the operator allows them at start
tools/                      EXISTS   edit hook, task guard, browser-safety check, metrics report
docs/                       EXISTS   the manual QA fork guide
scripts/setup.sh            EXISTS   what `pnpm bootstrap` runs
docker-compose.yml          EXISTS   local graph-node, postgres and ipfs
graph-node.toml             EXISTS   graph-node config for two chains at once
.github/workflows/          EXISTS   CI

apps/api                    planned  REST wrapper, Cloudflare Workers
apps/alerts                 planned  alerts service, Supabase
packages/testing            planned  shared fixtures: anvil, RPC mocks, Playwright helpers
```

Do not infer that a planned package exists because this file names it. Check.

`packages/core`, `packages/cli`, `packages/mcp`, `apps/web` and both subgraph packages each own a
`CLAUDE.md`.
Read the one for the package you are in, not all of them. `apps/web/CLAUDE.md` came with the fork
and names `yarn`. This repository uses pnpm, so run its scripts as
`pnpm --filter @cobuilders/safenet-web <script>`.

## Subgraphs

A subgraph manifest carries contract addresses and start blocks, and its ABI files carry event
signatures. So neither is written by hand. `pnpm generate` in each subgraph package writes
`subgraph.yaml` and `abis/` from `packages/core`, and both are git-ignored. `dev`, `build` and
`test` run it first.

`pnpm test` runs the matchstick tests, which feed hand-built events to the handlers and need no
chain. Each package also has a `differential` script. The Mainnet one compares a locally indexed
subgraph with the contracts read directly; the Gnosis one compares it with a `pnpm metrics` run.
Both query a local graph-node by default, or the URL in `SUBGRAPH_URL`. `pnpm graph:up` starts
graph-node, postgres and ipfs through Docker Compose, with ports from `.env.ports` and the archive
RPC from `.env.local`. `pnpm graph:down` stops them and discards the indexed data.

Each package deploys to Subgraph Studio with `deploy:studio`, locally or through the manual
workflow `.github/workflows/subgraphs-deploy.yml`. Its `CLAUDE.md` has the slug and the steps.

## Continuous integration

`.github/workflows/ci.yml` runs four jobs on every pull request and on every push to `main`:
`check`, `test`, `e2e` and `verify-abis`. `nightly.yml` runs the deep ABI scan, the unit tests,
both fork suites and the CLI and MCP smoke tests daily; all but the unit tests need the `MAINNET_RPC_URL`
secret, and fail without it. The fork suites stay out of per-PR CI because every run reads from
the archive node. `security.yml` runs a
dependency review on pull requests, skipped until the repository is public, and `pnpm audit`
weekly. `subgraphs-deploy.yml` runs only by hand: it deploys one or both subgraphs to
Studio with the `GRAPH_DEPLOY_KEY` secret. `parity.yml` runs `pnpm test:parity` daily and on
demand against the Studio deployments that `packages/core` names as the default endpoints, writes
the comparison to the job summary, and drives the badge in `README.md`. It stays out of per-PR CI
because its result depends on SEF's data and the deployed subgraphs, not on the code under review.
`release.yml` runs on a tag `v*` or by hand: its `build` job receives no secret, builds from
`apps/web/build.env`, packs `apps/web/release/app.car` and prints the CID; its `pin` job runs only
from `main` or a `v*` tag, needs `PINATA_JWT` and `PINATA_GATEWAY`, and fails when they are empty.

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
that is not `.env.local`. Never give a secret a `VITE_` name: Vite inlines every `VITE_` value
into the public bundle, and `pnpm check:browser` treats those values as public and does not flag
them.
