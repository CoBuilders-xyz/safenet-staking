# CLAUDE.md — safenet-staking

A pnpm and Turborepo monorepo. `apps/web` is the Safenet Beta staking interface. `packages/core`
holds the constants it reads, and every package added later reads them too.

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
| `pnpm bootstrap` | Runs `scripts/setup.sh`: checks tools, writes `.env.ports`, creates `.env.local`, installs. Safe to re-run. **Not `setup`: that is a pnpm builtin that edits your shell rc.** |
| `pnpm dev` | Starts the web app's Vite dev server and type-watches `packages/core`. |
| `pnpm build` | Builds all packages. |
| `pnpm test` | Unit tests. `apps/web` has 315 Vitest tests in 39 files. `packages/core` has none. |
| `pnpm check` | Lint, the browser-safety check, then types in every package. Run it before every commit. |

The test counts were measured with `pnpm --filter @cobuilders/safenet-web test` when this file was
written. Run it for the current number.

Scope to one package with `pnpm --filter @cobuilders/safenet-core check` or
`pnpm --filter @cobuilders/safenet-web check`.

Specific commands, only where they apply:

| Command | Where | What it proves | Today |
|---|---|---|---|
| `pnpm verify:abis` | `packages/core` | The high-frequency event signatures still match the chain, over a recent window | works |
| `pnpm verify:abis:deep` | `packages/core` | Every signature, including rare events, scanned from each deploy block | needs `ALCHEMY_MAINNET_RPC_URL` in `.env.local` |
| `pnpm metrics` | `packages/core` | The 24 metrics, computed against live chains and compared with SEF's published JSON. Writes `packages/core/.metrics/`, which is git-ignored | needs an archive node. With public RPC only, it stopped on a failed Mainnet log range when this file was written |
| `pnpm check:browser` | root | `apps/web/src` reads no `process.env`, and a built bundle contains no value from `.env.local` | works, part of `check` |
| `pnpm test:e2e` | `apps/web` | The interface behaves, against mocked RPC. 73 Playwright tests in 13 spec files | runs; one navigation test is intermittently flaky |
| `pnpm test:fork` | `apps/web`, `packages/cli` | Transactions execute against real contracts on Anvil | **fails on purpose: no suite** |
| `pnpm test:parity` | subgraphs | Our numbers match SEF's published JSON | **fails on purpose: no subgraph package** |

`turbo run <task>` with no package implementing the task reports a success while running nothing.
A green tick over a suite that does not exist is worse than a red one: a failure gets fixed, a
false pass gets believed. So `test:e2e`, `test:fork` and `test:parity` first run
`tools/require-task.mjs`, which fails unless some package implements the task. `test:e2e` passes
the guard because `apps/web` implements it. The other two fail until their suites exist. Do not
remove a guard before the real suite lands.

The e2e suite starts Vite on `E2E_PORT`, or on 5174 when it is unset, and reuses a server already
listening there. Two worktrees running the suite at once therefore share one server, and one
run fails when the other stops it. `scripts/setup.sh` writes a per-worktree `E2E_PORT` into
`.env.ports`, but nothing loads that file, and Turborepo's strict environment mode drops the
variable when you go through the root script. To isolate a run, call the package directly:
`E2E_PORT=<port> pnpm --filter @cobuilders/safenet-web test:e2e`.

## Layout

The target layout has nine packages. **Two exist on `main`.** The rest are listed so the shape is
known, not to suggest they are there:

```
apps/web          EXISTS     the fork of safe-fndn/safenet-staking-ui, under pnpm. Vitest unit and
                             Playwright e2e suites.
packages/core     EXISTS     addresses, start blocks, ABIs. The only source of constants.
tools/            EXISTS     edit hook, task guard, browser-safety check, metrics report renderer
scripts/setup.sh  EXISTS     what `pnpm bootstrap` runs

packages/subgraph-mainnet, packages/subgraph-gnosis    in review, not on main
apps/api          planned    REST wrapper, Cloudflare Workers
apps/alerts       planned    alerts service, Supabase
packages/cli      planned    safenet-cli
packages/mcp      planned    MCP server. Calls the shared library, not the CLI binary.
packages/testing  planned    shared fixtures: anvil, RPC mocks, Playwright helpers
```

Do not infer that a planned package exists because this file names it. Check.

`packages/core` and `apps/web` each own a `CLAUDE.md`. Read the one for the package you are in,
not all of them. `apps/web/CLAUDE.md` came with the fork and names `yarn`. This repository uses
pnpm, so run its scripts as `pnpm --filter @cobuilders/safenet-web <script>`.

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

## Secrets

Secrets live in `.env.local` at the repository root. `pnpm bootstrap` creates it, and git ignores
it. If you need a credential, read it from the environment. Never print one, and never write one
into a file that is not `.env.local`.
