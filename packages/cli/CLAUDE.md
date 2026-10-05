# packages/cli

`safenet`, the command-line interface for Safenet Beta. Read-only: it signs nothing and holds no
key. Every address, start block and event comes from `@cobuilders/safenet-core`.

## Why it is split in two

The MCP server will offer the same operations, and it calls a library, not this binary. So:

- `src/lib/` holds one module per operation. Each takes a `Context` (a Mainnet client and a
  `fetch`) and returns typed data: amounts as `bigint` wei, every figure with its source. It
  never prints, reads argv or exits. It is exported as `@cobuilders/safenet-cli/lib`.
- `src/commands/` holds the commander wiring, option validation with zod, and the rendering. No
  chain or SEF read happens there.
- `src/cli.ts` builds the program and maps failures to exit codes; `src/index.ts` only runs it.

A new operation goes in `src/lib/` first, with its data type, then gets a command.

## Commands

| Command | Reads |
|---|---|
| `safenet status` | Staking totals, the MerkleDrop root and balance on chain; SEF's `network-info.json`, `validator-info.json`, `rewards/latest.json` |
| `safenet validators list [--active\|--all] [--sort stake\|participation]` | stake and registration on chain; label, participation, commission and active from SEF's `validator-info.json` |
| `safenet validators show <address>` | the same for one validator, plus its delegators from `StakeIncreased` logs and `stakes()` |
| `safenet withdrawals list [--address <addr>]` | `totalPendingWithdrawals()` and the withdrawal logs; or `getPendingWithdrawals(staker)` |
| `safenet rewards check <address>` | SEF's proof file for the address; `cumulativeClaimed()` and `merkleRoot()` on chain |
| `safenet rewards history <address> [--all]` | `Claimed` logs for the address from the MerkleDrop deploy block, newest 20 unless `--all` |

Global options: `--json`, `--rpc-url <url>`, `--verbose`. Exit codes: 0 success, 1 the operation
failed (one sentence on stderr), 2 usage error.

Run it from the repository without building: `pnpm --filter @cobuilders/safenet-cli start status`.

## Rules the output keeps

- Every figure names its source: `chain: Contract.call()` or `SEF: file field`.
- Every participation rate states its window. The window comes from the commit that last wrote
  `validator-info.json`, floored to the hour, by `participationWindow()` in core; the file is read
  at that commit. When the GitHub API does not answer, the window is reported unknown, never
  guessed. `GITHUB_TOKEN` or `GH_TOKEN` raises its limit.
- Rewards allocated and unclaimed are derived only while the Merkle root on chain is the one in
  SEF's `latest.json`, the same rule as `useProgrammeRewards()` in the web app. Otherwise the
  balance still funds the old root, so both are null with a `reason`, and the raw balance shows
  as "SAFE held by MerkleDrop".
- Amounts print exactly, to the last wei. `--json` gives the same fields, with amounts as wei in
  decimal strings.
- An RPC URL can carry a key. It is never printed: `--verbose` shows the host only, and error
  messages have URLs removed.
- A log scan never skips a range. It shrinks the range when refused and fails when the smallest
  range is still refused. The library's error says what failed; the advice about
  `MAINNET_RPC_URL` and `--rpc-url` is added in the command layer, because the MCP server has no
  flags. The public endpoints in core refuse historical log scans, so `validators show` (delegators), `withdrawals list` without `--address`, and `rewards history`
  need an archive endpoint in `MAINNET_RPC_URL` or `--rpc-url`. `validators show` still prints
  without one and marks the delegators count unavailable.

## Tests

`pnpm test` runs the unit tests in `src/`, against a fake chain and fake SEF files in
`src/test-support.ts`. No network.

`pnpm test:smoke` runs `src/smoke/`: one test per command, against Mainnet, through the real
entry point. It reads `MAINNET_RPC_URL` from `.env.local` and skips each test, with the reason,
when it is not set. Turborepo's strict environment mode hides the variable from the root
`pnpm test`, so the smoke tests always skip there. The nightly workflow runs them with the secret.

`pnpm build` bundles `dist/index.js` with tsup. Core is bundled in, because it ships TypeScript
source; `commander`, `viem` and `zod` stay external.
