# safenet-cli

`safenet` is a command-line interface for Safenet staking on Ethereum Mainnet. Six commands
read the staking contracts and the data SEF (Safe Ecosystem Foundation) publishes. Five write:
stake, unstake and claim. Every write takes `--dry-run`, which signs nothing.

Each figure names its source: `chain: Contract.call()` or `SEF: file field`. Amounts print
exactly, to the last wei. `--json` gives the same fields, with amounts as wei in decimal strings.

## Install

The package is not on npm yet. Until it is, run it from a clone of this repository, without
building:

```sh
pnpm install
pnpm --filter @cobuilders/safenet-cli start status
```

Or build it and run the binary, which takes the same arguments as `safenet`:

```sh
pnpm --filter @cobuilders/safenet-cli build
node packages/cli/dist/index.js --help
```

After it is published, install it globally:

```sh
npm install -g @cobuilders/safenet-cli
safenet --help
```

Or run it once, without installing:

```sh
npx @cobuilders/safenet-cli status
```

Or, without Node.js, download the standalone binary for your system from the release of a
`cli-v<version>` tag on GitHub: `safenet-linux-x64`, `safenet-macos-arm64` or
`safenet-windows-x64.exe`. Check it against the release's `SHA256SUMS`, then run it:

```sh
sha256sum --check --ignore-missing SHA256SUMS
chmod +x safenet-linux-x64
./safenet-linux-x64 status
```

The binary carries its own Node.js. The macOS one is signed ad hoc, not by a developer
certificate, and the Windows one is unsigned, so each system may ask before it runs one
downloaded from the web.

To build the binary for your own system, use the Node version in `.nvmrc` and the locked dependencies:

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

| Command | What it does | Kind |
|---|---|---|
| `safenet status` | Network totals: stake, validators, withdrawals, rewards and the Merkle root | read |
| `safenet validators list` | Every validator SEF lists, with stake from the chain. `--active` (the default) or `--all`; `--sort stake` (the default) or `--sort participation`. A rate SEF does not publish prints as "not published", and as `null` with `--json` | read |
| `safenet validators show <address>` | One validator, with its delegators count. A rate SEF does not publish prints as "not published", and as `null` with `--json` | read |
| `safenet withdrawals list` | Pending withdrawals: the network figure and count, or one staker's queue with `--address <address>` | read |
| `safenet rewards check <address>` | Claimable, earned, claimed and held amounts, and whether the proof is current | read |
| `safenet rewards history <address>` | The address's reward claims, newest first. The newest 20, or every claim with `--all` | read |
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

`validators show` (its delegators count), `withdrawals list` without `--address`, and
`rewards history` scan the chain's history and need an archive RPC endpoint. The public endpoints
refuse such scans. `validators show` still prints without one and marks the delegators count
unavailable.

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

The key never comes from a flag value, which would land in the shell history and in `ps`. A
value that looks like a key where a name belongs is refused, and not repeated. No message prints
a key, a password, the value of a variable, or the name given for one. Without `--dry-run` and
without a signer option, a write exits 2.

### WalletConnect and hardware wallets

The bridge requires WalletConnect v2 and `eth_signTransaction`. Wallets that only support
`eth_sendTransaction` are unsupported. No physical device or companion app has been verified yet.
A software wallet can also connect. The CLI cannot prove that its account belongs to hardware.

Set `WALLETCONNECT_PROJECT_ID` using your existing WalletConnect project. Run this in an interactive terminal:

```sh
safenet stake "$VALIDATOR" 1 --walletconnect --wallet-account "$WALLET_ACCOUNT" --rpc-url "$RPC_URL"
```

Stop terminal recording. Type `connect` to display the sensitive pairing URI on stderr.
Paste it into your companion app's WalletConnect connection field. Never save it in logs, screenshots, or evidence.
Approve the expected Mainnet account. Each invocation creates a fresh session and keeps session data in memory only.

The CLI simulates each call before requesting its signature. It then displays the contract, function, arguments,
account, chain, gas limit, nonce, and fee limits. Amounts and fees use wei. Unlimited approval shows the full integer.
Type `sign` for each transaction, then compare the request with your device before approving it.
The CLI verifies the signed account and transaction fields, then broadcasts through the selected RPC.
The wallet never broadcasts the transaction. No wallet private key enters the CLI.

Reject a prompt or press Ctrl-C to cancel. Pairing, review, and signing each have a two-minute deadline.
Account changes, chain changes, session updates, disconnection, and expiry stop further signing.
A late signature after cancellation or timeout cannot trigger broadcast. Already broadcast transactions remain on chain.
Check any reported hash before retrying. The CLI closes the session after success, failure, and dry runs.

`--dry-run` with WalletConnect connects only to identify the account; it never requests a signature.
For unattended use, select `--dry-run --from "$WALLET_ACCOUNT"`. WalletConnect refuses noninteractive terminals.
MCP keeps its existing noninteractive local signers and defaults to dry runs. It never exposes wallet pairing through tools.

### Physical hardware acceptance

Automated transport tests are not physical hardware proof. Allow 30–60 minutes with the device operator.
Use a Ledger or Trezor test account with a companion app that explicitly supports WalletConnect v2 `eth_signTransaction`.
Do not assume Ledger Live, MetaMask, or another named app supports this method without checking its current capabilities.
An unsupported method is an acceptance blocker; record the device, firmware, app version, and refusal.

1. Prepare a separate Anvil Mainnet fork and a hardware test account. Fund that account only on the fork.
2. Use its isolated RPC endpoint. Keep the existing manual QA fork and stake untouched.
3. Read the validator and contract addresses from core or the fork. Set the command variables shown above.
4. Run the command with `--dry-run`. Approve pairing. Confirm no signature request and no nonce or stake change.
5. Run without `--dry-run`. Review both approval and stake on the terminal and device. Approve both.
6. Read the receipts, allowance, and stake from the fork. Confirm the stake increased by exactly one SAFE.
7. Repeat and reject on the device. Test terminal cancellation, disconnect, account change, chain change, and timeout.
8. Confirm no broadcast after each refusal. If approval already confirmed, record that partial result accurately.
9. After compliance integration, use a sanctioned fixture and confirm refusal before any device signature request.
10. Record public transaction hashes, receipt status, stake differences, device/app versions, and elapsed time in Linear.

Keep pairing URIs, keys, passwords, seed words, RPC credentials, and terminal recordings out of acceptance evidence.

## Settings

| Variable | What it sets |
|---|---|
| `WALLETCONNECT_PROJECT_ID` | Existing project ID used only for interactive WalletConnect signing |
| `MAINNET_RPC_URL` | The Mainnet RPC endpoint, tried before the public endpoints. `--rpc-url` overrides it |
| `GITHUB_TOKEN` or `GH_TOKEN` | Raises the GitHub API limit for the lookup that dates SEF's participation window. Optional |
| `IPFS_GATEWAY` | An IPFS gateway, tried before the public gateways for SEF's reward dataset. Only its origin is used: a path such as `/ipfs/` is dropped. Optional |

An RPC URL can carry a key. It is never printed: `--verbose` shows the host only, and error
messages have URLs removed.

## Reward data

SEF declares the IPFS dataset behind the ENS name `rewards.safenet-gov.eth` the canonical source of reward data, and keeps the repository `safe-fndn/safenet-data` as a temporary mirror. `status`, `rewards check` and both claims read `latest.json` and the proofs in the order the web interface uses: SEF's dataset through each IPFS gateway, `IPFS_GATEWAY` first and then ipfs.orbitor.dev and ipfs.filebase.io, but only when the name's contenthash is set; then the repository. ipfs.io and dweb.link are not listed: they retired on 2026-09-21 and answer every path with a 429 pointing at https://gatewaychanges.ipfs.io. The paths under the contenthash are assumed to repeat the repository's `assets/rewards` layout until SEF confirms the dataset's. A source that fails, answers 404, serves a file of the wrong shape or does not answer within 10 seconds falls through to the next; the gateways share one 10-second budget, and each in turn gets the time left divided by the gateways left. An address has no proof only when the repository, whose layout is known, answers 404, whatever the gateways did, so a gateway that is down never turns "never earned" into an error; `rewards check` then prints the file that answered 404 and the source that settled it. When no source has the file and the repository did not answer 404, the error names each source. The name is resolved once per run, and by the MCP server once an hour, or after a minute when the chain could not be read. `status --json` reports the source of `latest.json` in `rewardsSource`, and `rewards check --json` the source of the proof in `proofSource`, with the same fields: `kind`, `ens` for the dataset or `repository` for the mirror; the `url` and `gateway` read; `tried`, every source asked in order with its `outcome`, `found`, `not found`, `timeout`, `skipped` or `error`, and a `reason` for an error; and what the name held, as `ens.status` `set`, `empty`, `unsupported` or `unreadable`. A `not found` on every gateway while the repository has the file points at the dataset's layout, not at an outage, and the table says so. On 2026-10-08 the contenthash was empty, so the CLI read the repository; it reads the dataset as soon as SEF populates the name.

## Library

The package also exports the library the commands call, as `@cobuilders/safenet-cli/lib`, and
the program builder as `@cobuilders/safenet-cli/program`. Both ship with their declarations,
which need only `viem`, `zod` and `commander`, the package's own dependencies.

## Requirements

Node.js 22.14 or later.
