# CLAUDE.md — Safenet Track A

**`docs/internal/` and `docs/sef/` are untracked, not ignored.** They hold working notes,
unsent drafts and client correspondence, and this repository ships MIT and public. `git status`
lists them on purpose, so they stay visible and the decision to publish any of them stays
deliberate. **Never `git add` them without being asked.**

If you have them on this host, `docs/internal/project-context.md` is the place to start. If you
do not, the authoritative in-repo sources are `packages/core` for every address, start block and
ABI, and `pnpm metrics` for the numbers.

## Non-negotiables

**Never type a hex address, a start block, or an event signature anywhere except
`packages/core`.** Import them. This is the single rule that keeps agents from hallucinating
constants that look plausible and are wrong.

**No source file is authoritative for ABIs. Only the chain is.** The deployed Safenet contracts
match neither published branch of `safe-research/safenet`. If `verify:abis` fails, do not "fix"
a signature by reading a git branch. Recover the real signature from the chain.

**Work starts as an OpenSpec change, not in an editor.** Requirements carry identifiers such as
`WEB-014`. Tests name those identifiers. That link is what makes completeness measurable.

**State inferences as inferences.** If you have not verified something against a primary source,
say so. This project has already caught two confident claims that rested on stale sources.

## Commands

Every package implements the same five. Turborepo fans them out.

| Verb | What it does |
|---|---|
| `pnpm bootstrap` | Prepares everything. Safe to re-run. **Not `setup`: that is a pnpm builtin that edits your shell rc.** |
| `pnpm dev` | Starts the local stack. |
| `pnpm build` | Builds all packages. |
| `pnpm test` | Unit tests. |
| `pnpm check` | Lint and types. **The single gate before any commit.** No tests exist yet. |

Scope to one package with `pnpm --filter @cobuilders/safenet-core check`.

Specific commands, only where they apply:

| Command | Where | What it proves | Today |
|---|---|---|---|
| `pnpm verify:abis` | `packages/core` | Our event signatures still match the chain | works |
| `pnpm metrics` | `packages/core` | The 24 metrics, computed against live chains | works |
| `pnpm test:parity` | subgraphs | Our numbers match SEF's published JSON | **fails: no subgraph package** |
| `pnpm test:e2e` | `apps/web` | The interface behaves, against mocked RPC | **fails: no suite** |
| `pnpm test:fork` | `apps/web`, `packages/cli` | Transactions execute against real contracts on Anvil | **fails: no suite** |
| `pnpm spec:check` | root | Every requirement has a passing test, and no test names an unknown one | **fails: not built** |

The four that fail do so on purpose. Each used to exit 0 while running nothing, because
`turbo run <task>` with no package implementing the task reports a success. A green tick over
a suite that does not exist is worse than a red one: a failure gets fixed, a false pass gets
believed. `tools/require-task.mjs` makes the absence loud. Delete a guard when the real thing
lands, not before.

## Layout

D-004 sets the target layout. **Two of the nine packages exist.** The rest are listed so the
shape is known, not to suggest they are there:

```
apps/web-proto    EXISTS   prototype of the network overview. Ported onto the fork, then deleted.
apps/web          EMPTY    the slot the fork of safe-fndn/safenet-staking-ui lands in
packages/core     EXISTS   addresses, start blocks, ABIs. The only source of constants.
tools/            EXISTS   setup, hooks, gates
docs/internal     LOCAL    context, decisions, workflow. untracked, never committed
docs/sef          LOCAL    anything sent to the client. untracked, never committed

apps/api          planned  REST wrapper, Cloudflare Workers
apps/alerts       planned  alerts service, Supabase
packages/cli      planned  safenet-cli
packages/mcp      planned  MCP server. Calls the shared library, not the CLI binary.
packages/subgraph-mainnet, packages/subgraph-gnosis    planned
packages/testing  planned  shared fixtures: anvil, RPC mocks, Playwright helpers
```

Each package should own a `CLAUDE.md`. Only `packages/core` has one. Read the one for the
package you are in, not all of them.

Do not infer that a planned package exists because this file names it. Check.

## What happens when you edit

A hook runs on every edit to a TypeScript file. It lints the file and fixes what it can, which
warns but never blocks. Then it type-checks that package, which **does** block. A type error means
an assumption is wrong, so stop and fix it rather than working around it.

## Feedback loops

| When | What runs | Budget |
|---|---|---|
| After each edit | Lint the file, type-check its package | ~1s |
| Before push | `check` on changed packages, `openspec validate` | ~10s |
| CI | Everything, plus the chain and SEF's data | minutes |

## Secrets

Secrets live in `.env.local` on the host. Git-ignored, never baked into an image, never committed.
If you need a credential, read it from the environment. Never print one, and never write one into
a file that is not `.env.local`.
