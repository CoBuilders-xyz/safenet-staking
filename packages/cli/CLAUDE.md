# packages/cli

`safenet`, the command-line interface for Safenet: six read commands, and five writes that
stake, unstake and claim. Every write takes `--dry-run`, which signs nothing. Every address, start
block, event, function and error comes from `@cobuilders/safenet-core`.

## Why it is split in two

The MCP server in `packages/mcp` offers the same operations, and it calls a library, not this
binary. So:

- `src/lib/` holds one module per operation. Each takes a `Context` (a Mainnet client and a
  `fetch`) and returns typed data: amounts as `bigint` wei, every figure with its source. A write
  also takes a `WriteMode`: a `Signer` to send with, or the address a dry run simulates from. It
  never prints, reads argv, reads a key or exits. It is exported as `@cobuilders/safenet-cli/lib`.
  `src/lib/redact.ts` holds the redaction both front ends share: `errorSentence()` and
  `scrubSecrets()`.
- `src/commands/` holds the commander wiring, option validation with zod, and the rendering. No
  chain or SEF read happens there.
- `src/cli.ts` builds the program and maps failures to exit codes; `src/index.ts` only runs it.
  `buildProgram()` is exported as `@cobuilders/safenet-cli/program`, so the MCP server's tests
  can check that every command has a tool with the same arguments.

Both exports resolve to `dist/` with declarations, and to the TypeScript in `src/` under the
`source` condition. `packages/mcp` sets that condition in its `tsconfig.json`, its tsup config and
its test scripts, so checking and testing it need no build of this package.

A new operation goes in `src/lib/` first, with its data type, then gets a command.

`docs/commands.md` is the command reference: one section per command with its arguments and
options, an example, and the output of a real run against Mainnet in both formats, with URLs,
addresses, deploy blocks and the example stakers' hashes replaced by labels. A change to a
command's options or output changes its section.

## Commands

| Command | Reads |
|---|---|
| `safenet status` | Staking totals, the MerkleDrop root and balance on chain; SEF's `network-info.json`, `validator-info.json`, `rewards/latest.json` |
| `safenet validators list [--active\|--all] [--sort stake\|participation]` | stake and registration on chain; label, participation, commission and active from SEF's `validator-info.json` |
| `safenet validators show <address>` | the same for one validator, plus its delegators from `StakeIncreased` logs and `stakes()` |
| `safenet withdrawals list [--address <addr>]` | `totalPendingWithdrawals()` and the withdrawal logs; or `getPendingWithdrawals(staker)` |
| `safenet rewards check <address>` | SEF's proof file for the address; `cumulativeClaimed()` and `merkleRoot()` on chain |
| `safenet rewards history <address> [--all]` | `Claimed` logs for the address from the MerkleDrop deploy block, newest 20 unless `--all`; then the periods: the Mainnet subgraph's `RewardPeriod` and `RewardClaim` at one indexed block, and `cumulativeClaimed()` at each period's last block |

The writes send what the web interface sends, in the same order:

| Command | Sends |
|---|---|
| `safenet stake <validator> <amount> [--approve exact\|unlimited]` | `approve` on the SAFE token only when the allowance is below the amount, exact by default; then `stake(validator, amount)` |
| `safenet unstake <validator> <amount>` | `initiateWithdrawal(validator, amount)`, which starts the delay |
| `safenet withdrawals claim <id \| --all>` | `claimWithdrawal()` once per withdrawal. It takes no id and pays the oldest first, so `<id>` claims every one up to it. Only withdrawals past their delay, read from `withdrawalQueues` and `withdrawalNodes`, are claimed; the rest are named |
| `safenet rewards claim` | `claim` with SEF's proof for the signer, read at core's `rewardProofPath()` from the first source that has it, only while the proof's root is the root on chain; otherwise one sentence and exit 1 |
| `safenet rewards claim-and-stake <validator> [--amount] [--approve]` | the claim, then the approval if short, then the stake of what the claim's SAFE `Transfer` log says arrived, or of `--amount`. An `--amount` above the proof's claimable amount is refused before anything is sent, as `stake` and `unstake` refuse. Only when the claim pays less than `--amount` is what arrived staked instead, with a line on stderr and `cappedToReceived` in the result. One transaction after another; no EIP-5792 batch |

Global options: `--json`, `--rpc-url <url>`, `--verbose`. Exit codes: 0 success, 1 the operation
failed (one sentence on stderr), 2 usage error.

Run it from the repository without building: `pnpm --filter @cobuilders/safenet-cli start status`.

## Writes, signing and `--dry-run`

- Every call is simulated with `eth_call` and estimated with `eth_estimateGas` before it is sent,
  so a revert is decoded first: core's custom errors (`MerkleRootWasUpdated`, the staking errors)
  read as a sentence, and a reason string is quoted. A failure exits 1. When a later transaction
  fails, the sentence names the ones already confirmed, which stay on chain.
- `--dry-run` does the same reads and simulations and prints what would be sent: contract,
  function, every argument, the gas and where it came from. A call that depends on an earlier one
  in the same command, such as a stake after its approval, cannot be estimated with
  `eth_estimateGas`, which sees mined state only; it is simulated with `eth_simulateV1` after the
  calls before it, and its gas is the gas the simulation used. A dry run has no signer: the
  library is given an address, not a key.
- Local signing: `--private-key-env <NAME>` reads it from the environment variable
  NAME, never from a flag value; `--keystore <path>` decrypts a version 3 keystore, asking for the
  password without echo or reading it from `--password-env <NAME>`. A value passed where a variable
  name belongs is refused without being repeated, and no message repeats the name given for a
  variable, which could be the secret typed in its place. Without `--dry-run` and without a signer
  option, a write exits 2. `--from <address>` sets the address of a dry run without a signer.
  Every environment-key invocation emits `ENV_KEY_WARNING` from `src/cli.ts` on stderr, including dry runs.
- `--walletconnect --wallet-account <address>` loads the external signer in `commands/walletconnect.ts`.
  It requires a terminal, `WALLETCONNECT_PROJECT_ID`, and WalletConnect v2 `eth_signTransaction` support.
  Pairing URI display requires deliberate confirmation. Never capture the URI in evidence.
  It verifies the approved chain/account, reviews each simulated transaction, validates returned signed bytes,
  and broadcasts through the selected RPC. Session storage is memory only. Command cleanup closes the signer.
  Cancellation, account/chain changes, disconnect, expiry, and timeouts prevent further signatures and broadcasts.
  `src/fork/signers.test.ts` proves effects using an emulated transport; it does not prove physical hardware.
  Compliance gates remain owned by the compliance integration branch.
- A live write first checks that the endpoint is on chain 1. Each transaction's hash goes to
  stderr the moment it is sent, and its receipt when it confirms, so `--json` stays one document
  on stdout. A hash whose receipt cannot be read is reported as sent, with the hash, and is not
  retried. The hash is computed from the signed bytes before the broadcast, so a broadcast that
  fails is reported with it too: the node may have taken the transaction anyway.
- Amounts are typed in SAFE, exactly, up to 18 decimals. Results carry each amount as both
  `wei` and `safe`.

## Rules the output keeps

- Every figure names its source: `chain: Contract.call()` or `SEF: file field`.
- Every participation rate states its window. The window comes from the commit that last wrote
  `validator-info.json`, floored to the hour, by `participationWindow()` in core; the file is read
  at that commit. When the GitHub API does not answer, the window is reported unknown, never
  guessed. `GITHUB_TOKEN` or `GH_TOKEN` raises its limit.
- Reward files come from SEF's IPFS dataset behind its ENS name when the contenthash is set,
  through each gateway, and then from the repository mirror: `readRewards()` in `src/lib/sef.ts`,
  over core's `src/rewards-source.ts`. `status` reports the source used as `rewardsSource`.
- Rewards allocated and unclaimed are derived only while the Merkle root on chain is the one in
  SEF's `latest.json`, the same rule as `useProgrammeRewards()` in the web app. Otherwise the
  balance still funds the old root, so both are null with a `reason`, and the raw balance shows
  as "SAFE held by MerkleDrop".
- `rewards history`'s periods come from the Mainnet subgraph, `src/lib/reward-periods.ts`: every
  query pinned to the block `_meta` gives, and for each period the subgraph's cumulative claimed
  for the address at the period's last block against `cumulativeClaimed()` on chain at that same
  block. A period's claimed figure is what the address claimed while that root was current; what
  it paid out is in SEF's files, not on chain. When the subgraph cannot answer, `periods` is null
  with `periodsReason`, and the claims, read from the chain, still print. The endpoint is
  `SUBGRAPH_URL_MAINNET` when set, else core's `SUBGRAPH_ENDPOINTS.mainnet`, and is never printed.
- Amounts print exactly, to the last wei. `--json` gives the same fields, with amounts as wei in
  decimal strings.
- An RPC URL can carry a key. It is never printed: `--verbose` shows the host only, and error
  messages have URLs removed.
- A usage error repeats nothing that may be a secret: `scrubUsage()` in `src/cli.ts`, which is
  the library's `scrubSecrets()`, removes the value of any `--flag=value`, which commander would
  repeat for an unknown option such as `--private-key=<key>`, and URLs and runs of 64 or more hex
  digits, which a key typed as an argument would leave in the validation message.
- A log scan never skips a range. It shrinks the range when refused and fails when the smallest
  range is still refused. The library's error says what failed; the advice about
  `MAINNET_RPC_URL` and `--rpc-url` is added in the command layer, because the MCP server has no
  flags. The public endpoints in core refuse historical log scans, so `validators show` (delegators), `withdrawals list` without `--address`, and `rewards history`
  need an archive endpoint in `MAINNET_RPC_URL` or `--rpc-url`. `validators show` still prints
  without one and marks the delegators count unavailable.

## Tests

`pnpm test` runs the unit tests in `src/`, against a fake chain and fake SEF files in
`src/test-support.ts`. No network. `src/writes.test.ts` runs every write with `--dry-run` and a
signer whose `signTransaction` throws, and fails if it is reached. `src/reward-periods.test.ts`
checks the periods against a fake subgraph, the chain read at each period's last block, a
subgraph that differs, one that is down, and the override. `src/fork/redaction.test.ts`
also runs here: it makes the fork suite's archive read fail and checks that its error carries no
part of the URL.

`pnpm test:coverage` runs the same unit tests without `src/smoke/` and `src/fork/`, and fails
below 80 percent of lines, measured by Node's built-in coverage through
`tools/run-node-tests.mjs`. That runner fails too when a source file is missing from the report
because no test loads it. `src/index.ts` and `src/sea.ts` only start and stop the program.
They are named as unmeasured because entry-point tests run them in child processes or bundles.
`src/entrypoint.test.ts` and `src/sea.test.ts` still run; the latter checks the isolated binary bundle. Lines that tsx's source maps leave unmapped, such as a leading comment or an import,
count as uncovered, so the figure is a lower bound. CI runs it in the `test` job.

`pnpm test:smoke` runs `src/smoke/`: one test per command, against Mainnet, through the real
entry point. It reads `MAINNET_RPC_URL` from `.env.local` and skips each test, with the reason,
when it is not set. Turborepo's strict environment mode hides the variable from the root
`pnpm test`, so the smoke tests always skip there. The nightly workflow runs them with the secret.

`pnpm test:fork` runs `src/fork/`: Anvil forks Mainnet at core's `MAINNET_FORK` block on
`CLI_ANVIL_PORT` from `.env.ports` (8546 without it), and the five writes are sent for real and
checked by reading the chain: the stake delta and the allowance, the pending withdrawal, the claim
after a clock warp past the delay, `cumulativeClaimed` for a real address with a published proof,
and claim-and-stake end to end. Then every write runs again with `--dry-run` and a signer whose
`signTransaction` throws, and the chain must not change. Stake, unstake and the withdrawal claims
sign with a key from the environment through the CLI's own signer; the rewards claims are signed
by Anvil for the impersonated claimer, whose key nobody has, and read SEF's proofs at the commit
pinned next to the block. It needs `anvil` and the archive `MAINNET_RPC_URL`, fails without them,
stops only its own Anvil when it ends, and runs nightly. Under `pnpm test` it is skipped with the
reason.

`pnpm build` bundles `dist/index.js`, the binary, with tsup, and `dist/lib/index.js` and
`dist/program.js` with their declarations. Core is bundled in, because it ships TypeScript
source; `commander`, `viem` and `zod` stay external. The declarations must not name core, which
is not published: tsup's `dts.resolve` leaves a broken import for core's TypeScript source, so a
type the public API returns is declared in this package. `SefValidator` in `src/lib/sef.ts` is
one; `src/lib/sef.test.ts` fails to type-check when it differs from core's.

`pnpm build:binary` writes the standalone binary for this machine, `binaries/safenet-<os>-<arch>`,
with `scripts/build-binary.mjs`: Node's single executable applications. The CLI and every
dependency are bundled into one CommonJS script from `src/sea.ts`, which waits on `run()` because
a CommonJS script has no top-level await, and the script's blob is injected with `postject` into a
copy of the Node running the build, which must match `.nvmrc`. On macOS the copy is signed ad hoc.
The bundle includes WalletConnect's dynamic imports, uses the JavaScript fallback for optional
WebSocket native addons, and fails the build if a non-Node import remains external.
`--verify-reproducible` compares two clean builds of the final executable. Relative SEA script
names keep temporary paths out of the blob. The entry flushes output before exiting, as `index.ts` does.
`src/sea.test.ts` runs that bundle with plain node from an empty directory.
`scripts/smoke-binary.ts` checks a read and a dry-run simulation using the existing fake chain over
an isolated loopback RPC port, with no signing or broadcast. CI runs it against every native binary.
`.github/workflows/cli-binaries.yml` builds the
binary for Linux x64, macOS arm64 and Windows x64, runs each alone against Mainnet, writes
`SHA256SUMS`, verifies all three individual build sums, and attaches them to the GitHub Release
of a `cli-v<version>` tag. CLI, core, lockfile and runtime changes trigger the platform checks.
Physical wallet acceptance and a rerun against the final integrated CLI remain release requirements.
