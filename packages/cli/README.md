# safenet-cli

`safenet` is a command-line interface for Safenet Beta staking on Ethereum Mainnet. Six commands
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

## Commands

| Command | What it does | Kind |
|---|---|---|
| `safenet status` | Network totals: stake, validators, withdrawals, rewards and the Merkle root | read |
| `safenet validators list` | Every validator SEF lists, with stake from the chain. `--active` (the default) or `--all`; `--sort stake` (the default) or `--sort participation` | read |
| `safenet validators show <address>` | One validator, with its delegators count | read |
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

Signing is a local key only. A signer option takes the name of a variable or the path of a
file, never the secret itself. `--from` takes an address and needs no key.

| Option | What it does |
|---|---|
| `--private-key-env <NAME>` | Sign with the private key held in the environment variable NAME |
| `--keystore <path>` | Sign with a version 3 keystore file. The password is asked for without echo |
| `--password-env <NAME>` | With `--keystore`: read the password from the environment variable NAME |
| `--from <address>` | With `--dry-run` and no signer option: the address to simulate from |

The key never comes from a flag value, which would land in the shell history and in `ps`. A
value that looks like a key where a name belongs is refused, and not repeated. No message prints
a key, a password, the value of a variable, or the name given for one. Without `--dry-run` and
without a signer option, a write exits 2.

## Settings

| Variable | What it sets |
|---|---|
| `MAINNET_RPC_URL` | The Mainnet RPC endpoint, tried before the public endpoints. `--rpc-url` overrides it |
| `GITHUB_TOKEN` or `GH_TOKEN` | Raises the GitHub API limit for the lookup that dates SEF's participation window. Optional |

An RPC URL can carry a key. It is never printed: `--verbose` shows the host only, and error
messages have URLs removed.

## Library

The package also exports the library the commands call, as `@cobuilders/safenet-cli/lib`, and
the program builder as `@cobuilders/safenet-cli/program`. Both ship with their declarations,
which need only `viem`, `zod` and `commander`, the package's own dependencies.

## Requirements

Node.js 22.14 or later.
