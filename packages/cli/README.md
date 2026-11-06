# safenet

`safenet` is a command-line interface for Safenet staking on Ethereum Mainnet. Six commands
read the staking contracts and the data SEF (Safe Ecosystem Foundation) publishes. Five write:
stake, unstake and claim. Every write takes `--dry-run`, which signs nothing.

Each figure names its source: `chain: Contract.call()` or `SEF: file field`. Amounts print
exactly, to the last wei. `--json` gives the same fields, with amounts as wei in decimal strings.

## Install

The npm package is `@cobuilders/safenet-cli`. Its executable is `safenet`.
Install the published beta globally:

```sh
npm install -g @cobuilders/safenet-cli@beta
safenet --help
```

Or run it once, without installing:

```sh
npx @cobuilders/safenet-cli@beta status
```

Standalone binaries are not published yet. Use npm or npx to run the CLI.

### Optional local development

To work from a clone of this repository, run the CLI without building:

```sh
pnpm install
pnpm --filter @cobuilders/safenet-cli start status
```

Or build it and run the bundle, which takes the same arguments as `safenet`:

```sh
pnpm --filter @cobuilders/safenet-cli build
node packages/cli/dist/index.js --help
```

To build the standalone binary for your system, use the Node version in `.nvmrc` and the locked dependencies:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cobuilders/safenet-cli build:binary --verify-reproducible
```

This builds twice in separate temporary directories and compares the final executable's SHA256.
It writes the executable and its `.sha256` file under `packages/cli/binaries/`.
Reproduction requires the same source, lockfile, official Node binary, operating system and architecture.
Cross-platform binaries have different checksums. WalletConnect uses bundled JavaScript WebSocket
implementations; no optional native addon or external `node_modules` directory is required.

The workflow checks each executable in an isolated directory with only that directory on `PATH`.
It runs a read and an unstake dry run against a loopback fixture, rejects headless WalletConnect,
and checks Mainnet `status --json`. The checksum job requires all three platforms and verifies
their individual checksums before creating `SHA256SUMS`.
These checks do not prove pairing or signing with a physical wallet.
Before publication, rerun the binary workflow against the final CLI tree, including later CLI integrations.

On macOS, compare `shasum -a 256 safenet-macos-arm64` with its entry in `SHA256SUMS`.
On Windows, compare `(Get-FileHash .\safenet-windows-x64.exe -Algorithm SHA256).Hash` with its entry.

## Commands

The [command reference](docs/commands.md) gives each command's arguments and options, an example,
and what it printed against Mainnet, in the human format and with `--json`.

| Command | What it does | Kind |
|---|---|---|
| `safenet status` | Network totals: stake, validators, withdrawals, rewards and the Merkle root | read |
| `safenet validators list` | Every validator SEF lists, with stake from the chain. `--active` (the default) or `--all`; `--sort stake` (the default) or `--sort participation`. A rate SEF does not publish prints as "not published", and as `null` with `--json` | read |
| `safenet validators show <address>` | One validator, with its delegators count. A rate SEF does not publish prints as "not published", and as `null` with `--json` | read |
| `safenet withdrawals list` | Pending withdrawals: the network figure and count, or one staker's queue with `--address <address>` | read |
| `safenet rewards check <address>` | Claimable, earned, claimed and held amounts, and whether the proof is current | read |
| `safenet rewards history <address>` | The address's reward claims, newest first, the newest 20 or every claim with `--all`; then each distribution period from the Mainnet subgraph, with the address's claims in it and its cumulative claimed checked against the chain at the period's last block | read |
| `safenet stake <validator> <amount>` | Stake SAFE on a validator, approving the staking contract first when the allowance is short. `--approve exact` (the default) or `--approve unlimited` | write |
| `safenet unstake <validator> <amount>` | Start a withdrawal of SAFE staked on a validator. It becomes claimable after the delay | write |
| `safenet withdrawals claim [id]` | Claim withdrawals past their delay, up to and including `id`, or every one with `--all`. The contract pays the oldest first | write |
| `safenet rewards claim` | Claim the signer's rewards with SEF's published proof, while its root is the root on chain | write |
| `safenet rewards claim-and-stake <validator>` | Claim the signer's rewards, then approve and stake what arrived on a validator, one transaction after another. `--amount <amount>` stakes that much and leaves the rest; `--approve` as for `stake` | write |

An amount is typed in SAFE, such as `100` or `0.5`, exactly, up to 18 decimals.

Global options, before or after the command:

| Option | What it does |
|---|---|
| `--json` | Machine output with the same fields; amounts in wei as decimal strings |
| `--rpc-url <url>` | The Mainnet RPC endpoint. Default: `MAINNET_RPC_URL`, then public endpoints |
| `-v`, `--verbose` | Print the RPC host in use, never its full URL, to stderr |

Exit codes: 0 on success; 1 when the operation failed, with one sentence on stderr; 2 on a usage
error.

`rewards history` and network-wide `withdrawals list` read the public Mainnet subgraph first.
They page every row at one verified block hash, then read recent RPC logs through the requested head.
The source states the indexed block, lag and completed coverage. Totals must match the contract.
An unavailable, incomplete or stale index falls back to a full RPC log scan.
If neither path completes, the command exits 1 without a partial JSON document or a false empty result.
RPC providers differ in log range, rate and retention limits; historical logs do not inherently require archive state.
`validators show` keeps its existing log scan and marks its delegators count unavailable if that scan fails.


## Writes and `--dry-run`

A write simulates and estimates every transaction before it is sent, so a revert is decoded
first. Each transaction's hash goes to stderr the moment it is sent, and its receipt when it
confirms, so `--json` stays one document on stdout. A live write first checks that the endpoint
is on chain 1.

`--dry-run` does the same reads and simulations and prints what would be sent: the contract, the
function, every argument, the gas and where it came from. Nothing is signed. A dry run has no
signer: `--from <address>` gives it the address to simulate from. With a signer option instead,
the signer is loaded for its address only.

## Signing

Choose an environment key, a keystore, or an external wallet through WalletConnect.
`--from` takes an address and needs no key.

| Option | What it does |
|---|---|
| `--private-key-env <NAME>` | Sign with the environment key. Every invocation warns about key exposure |
| `--walletconnect --wallet-account <address>` | Pair an external wallet and require this Mainnet account |
| `--keystore <path>` | Sign with a version 3 keystore file. The password is asked for without echo |
| `--password-env <NAME>` | With `--keystore`: read the password from the environment variable NAME |
| `--from <address>` | With `--dry-run` and no signer option: the address to simulate from |

A key read with `--private-key-env` prints one warning line on stderr: every process the shell
starts inherits the variable, while a keystore holds the key encrypted. The key never comes from a
flag value, which would land in the shell history and in `ps`. A
value that looks like a key where a name belongs is refused, and not repeated. No message prints
a key, a password, the value of a variable, or the name given for one. Without `--dry-run` and
without a signer option, a write exits 2.

### WalletConnect and hardware wallets

The bridge requires WalletConnect v2 and `eth_sendTransaction`, as used by the web interface.
No physical device or companion app has been verified with this CLI change yet.
A software wallet can also connect. The CLI cannot prove that its account belongs to hardware.

The CLI uses project ID `f35bb4d915df109f8006841b674b5604` by default.
Optionally set `WALLETCONNECT_PROJECT_ID` to use your own project.
Run this in an interactive terminal. Pass `--wallet-account` with the expected Mainnet address:

```sh
safenet stake "$VALIDATOR" 1 --walletconnect --wallet-account "$WALLET_ACCOUNT" --rpc-url "$RPC_URL"
```

Stop terminal recording. Type `connect` to display the sensitive pairing QR and URI on stderr.
Scan the QR or paste the URI into your companion app's WalletConnect connection field.
Never save either in logs, screenshots, or evidence.
Approve the expected Mainnet account. Each invocation creates a fresh session and keeps session data in memory only.

The CLI simulates each call before requesting its signature. It then displays the contract, function, arguments,
account, chain, gas limit, nonce, and fee limits. Amounts and fees use wei. Unlimited approval shows the full integer.
Type `sign` for each transaction, then compare the request with your device before approving it.
**Warning: the wallet signs and broadcasts each transaction through its own RPC.**
The CLI validates the returned 32-byte transaction hash and polls receipts through the selected CLI RPC.
After a successful receipt, it checks the mined sender, destination, calldata, and zero value against the reviewed call.
A mismatch or failed lookup stops confirmation and all subsequent steps. The wallet may already have broadcast.
Wallet changes to nonce, gas, and fees are allowed.
The CLI cannot verify signed bytes before broadcast. Compare the complete request on your wallet before approving.
Use a wallet and CLI RPC connected to the same network. No wallet private key enters the CLI.

Reject a prompt or press Ctrl-C to cancel. Pairing, review, and wallet requests have two-minute deadlines.
Account changes, chain changes, session updates, disconnection, and expiry stop further CLI requests.
**Cancellation, timeout, or disconnection cannot stop a wallet request already sent. The wallet may still broadcast.**
Check wallet activity and any reported hash before retrying. Already broadcast transactions remain on chain.
The CLI closes the session after success, failure, and dry runs.

`--dry-run` with WalletConnect connects only to identify the account; it never requests a signature.
For unattended use, select `--dry-run --from "$WALLET_ACCOUNT"`. WalletConnect refuses noninteractive terminals.
MCP keeps its existing noninteractive local signers and defaults to dry runs. It never exposes wallet pairing through tools.

### Physical hardware acceptance

Automated transport tests are not physical hardware proof. Allow 30–60 minutes with the device operator.
Use a Ledger or Trezor test account with a companion app that explicitly supports WalletConnect v2 `eth_sendTransaction`.
Do not assume Ledger Live, MetaMask, or another named app supports this method without checking its current capabilities.
An unsupported method is an acceptance blocker; record the device, firmware, app version, and refusal.

1. Prepare a separate Anvil Mainnet fork and a hardware test account. Fund that account only on the fork.
2. Configure both the wallet and CLI to use that isolated fork RPC. A CLI RPC override alone cannot redirect wallet broadcasts.
   Keep the existing manual QA fork and stake untouched.
3. Read the validator and contract addresses from core or the fork. Set the command variables shown above.
4. Run the command with `--dry-run`. Approve pairing. Confirm no signature request and no nonce or stake change.
5. Run without `--dry-run`. Review both approval and stake on the terminal and device. Approve both.
6. Read the receipts, allowance, and stake from the fork. Confirm the stake increased by exactly one SAFE.
7. Repeat and reject on the device. Test terminal cancellation, disconnect, account change, chain change, and timeout.
8. Confirm no broadcast after wallet refusal. Check wallet activity after cancellation, disconnect, or timeout; pending requests may broadcast.
   If approval already confirmed, record that partial result accurately.
9. Use a sanctioned fixture and confirm refusal before any device signature request.
10. Record public transaction hashes, receipt status, stake differences, device/app versions, and elapsed time in Linear.

Keep pairing URIs, keys, passwords, seed words, RPC credentials, and terminal recordings out of acceptance evidence.

## Compliance gates

Every write checks these before it signs anything, dry runs included. They are the gates of the
web interface.

| Gate | When | Refuses when |
|---|---|---|
| Sanctions oracle | Always | The oracle on chain lists the address that would sign, or `--from`. It also refuses when the oracle cannot be read |
| `--sanctions-endpoint <url>` | When given | A GET to the URL answers 403, any other error, or nothing. The endpoint judges the client making the request, so no address is sent |
| `--geo-check` | When given | This machine's IP address is in a country the web interface blocks, or no lookup names a country |

Each gate fails closed: an answer that is not a clear yes refuses. A refusal exits 1 with one
sentence that names each gate that refused and why. With `--json`, stdout also holds the report,
`{ "refused": true, "compliance": { ... } }`. A write that passes prints the gates it passed, and
its `--json` result carries the same report as `compliance`. The endpoint's URL is never printed:
it may carry a key.

These gates do not provide full five-list sanctions screening. That work remains separate.
The web visitor endpoint remains unset; CLI operators can still supply their own endpoint.

## Settings

| Variable | What it sets |
|---|---|
| `WALLETCONNECT_PROJECT_ID` | Optional override for the built-in project ID `f35bb4d915df109f8006841b674b5604` |
| `MAINNET_RPC_URL` | The Mainnet RPC endpoint, tried before the public endpoints. `--rpc-url` overrides it |
| `GITHUB_TOKEN` or `GH_TOKEN` | Raises the GitHub API limit for the lookup that dates SEF's participation window. Optional |
| `IPFS_GATEWAY` | An IPFS gateway, tried before the public gateways for SEF's reward dataset. Only its origin is used: a path such as `/ipfs/` is dropped. Optional |
| `GRAPH_API_KEY` | Optional runtime Graph Network key. Full `SUBGRAPH_URL_MAINNET` wins; without either, use new-account Studio. Never printed. |
| `SUBGRAPH_URL_MAINNET` | The Mainnet subgraph `rewards history` and network withdrawals read indexed history from, instead of the Studio deployment in `packages/core`. Never printed. Optional |

An RPC URL can carry a key. It is never printed: `--verbose` shows the host only, and error
messages have URLs removed.

## Reward data

`rewards history` assigns claims to approximate whole-block windows, from each root-update block
through the block before the next update. The current window ends at the indexed head.
Claims before an update in its block also enter the new window: the schema lacks root-update log indices.
Cumulative comparisons remain exact at each window's last block. These rows show claims, not period earnings.
An invalid `SUBGRAPH_URL_MAINNET` leaves periods unavailable, with a fixed error that never repeats the setting.
The chain claim history remains available.

SEF declares the IPFS dataset behind the ENS name `rewards.safenet-gov.eth` the canonical source of reward data, and keeps the repository `safe-fndn/safenet-data` as a temporary mirror. `status`, `rewards check` and both claims read `latest.json` and the proofs in the order the web interface uses: SEF's dataset through each IPFS gateway, `IPFS_GATEWAY` first and then ipfs.orbitor.dev and ipfs.filebase.io, but only when the name's contenthash is set; then the repository. ipfs.io and dweb.link are not listed: they retired on 2026-09-21 and answer every path with a 429 pointing at https://gatewaychanges.ipfs.io. The paths under the contenthash are assumed to repeat the repository's `assets/rewards` layout until SEF confirms the dataset's. A source that fails, answers 404, serves a file of the wrong shape or does not answer within 10 seconds falls through to the next; the gateways share one 10-second budget, and each in turn gets the time left divided by the gateways left. An address has no proof only when the repository, whose layout is known, answers 404, whatever the gateways did, so a gateway that is down never turns "never earned" into an error; `rewards check` then prints the file that answered 404 and the source that settled it. When no source has the file and the repository did not answer 404, the error names each source. The name is resolved once per run, and by the MCP server once an hour, or after a minute when the chain could not be read. `status --json` reports the source of `latest.json` in `rewardsSource`, and `rewards check --json` the source of the proof in `proofSource`, with the same fields: `kind`, `ens` for the dataset or `repository` for the mirror; the `url` and `gateway` read; `tried`, every source asked in order with its `outcome`, `found`, `not found`, `timeout`, `skipped` or `error`, and a `reason` for an error; and what the name held, as `ens.status` `set`, `empty`, `unsupported` or `unreadable`. A `not found` on every gateway while the repository has the file points at the dataset's layout, not at an outage, and the table says so. On 2026-10-08 the contenthash was empty, so the CLI read the repository; it reads the dataset as soon as SEF populates the name.

## Library

The package also exports the library the commands call, as `@cobuilders/safenet-cli/lib`, and
the program builder as `@cobuilders/safenet-cli/program`. Both ship with their declarations,
which need only `viem`, `zod` and `commander`, the package's own dependencies.

## Requirements

Node.js 22.14 or later.

For gateway subgraph restrictions, the USD 20/month cap, fallback behavior and operator setup, see [GRAPH-GATEWAY.md](https://github.com/CoBuilders-xyz/safenet-staking/blob/main/GRAPH-GATEWAY.md). Supply `GRAPH_API_KEY` through the process environment; no command-line key flag is needed.

Failed Network queries retry Studio once. The process warns on stderr once per chain; if both fail, history reports unavailable without leaking URLs.

## Beta publishing

The in-repo version is `0.1.0-beta.2`.
CI uses npm Trusted Publishing (GitHub OIDC), with dist-tag `beta` and no permanent npm token.
Publishing beta.2 updates the `beta` tag; it does not change `latest`.
See [NPM-RELEASE.md](https://github.com/CoBuilders-xyz/safenet-staking/blob/main/NPM-RELEASE.md) for the operator checklist.

Period comparisons use the same subgraph endpoint as claim history, then verify
`cumulativeClaimed(address)` through historical RPC `eth_call` requests at each period end.
A provider can serve current balances and recent logs while refusing those historical state reads.
Such failures identify the RPC operation and block in `periodsReason`; they do not imply a failed GraphQL query.
Use an RPC with historical contract-state access to obtain verified periods.
