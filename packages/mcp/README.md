# safenet-mcp

An [MCP](https://modelcontextprotocol.io) server for Safenet Beta staking on Ethereum Mainnet.
It gives an AI client the reads of the `safenet` command-line interface, and its writes as dry
runs. It talks over stdio.

Each tool returns the figures with their source: `chain: Contract.call()` or `SEF: file field`.
Amounts are exact, in wei, as decimal strings.

Writes are off by default. A write tool then simulates the transactions and returns what would be
sent, and signs nothing. The operator can allow writes when the server starts; a model can never
turn them on, and no key or password ever goes through a tool.

> A demo video will be linked here.

## Tools

| Tool | Arguments | Kind |
|---|---|---|
| `status` | none | read |
| `validators_list` | `active` (boolean), `all` (boolean), `sort` (`"stake"` or `"participation"`, default `"stake"`) | read |
| `validators_show` | `address` | read |
| `withdrawals_list` | `address` (optional: one staker's queue; without it, the network total and count) | read |
| `rewards_check` | `address` | read |
| `rewards_history` | `address`, `all` (boolean: every claim, not only the newest 20) | read |
| `stake` | `validator`, `amount` (SAFE, such as `"100"` or `"0.5"`), `approve` (`"exact"` or `"unlimited"`, default `"exact"`), `dryRun`, `from` | write |
| `unstake` | `validator`, `amount`, `dryRun`, `from` | write |
| `withdrawals_claim` | `id` (claims up to and including it) or `all` (boolean), `dryRun`, `from` | write |
| `rewards_claim` | `dryRun`, `from` | write |
| `rewards_claim_and_stake` | `validator`, `amount` (optional), `approve`, `dryRun`, `from` | write |

Each tool mirrors the `safenet` command of the same name: `validators_list` is
`safenet validators list`, `rewards_claim_and_stake` is `safenet rewards claim-and-stake`.

- `dryRun` defaults to `true`, and is forced to `true` unless writes are allowed (see below).
- `from` is the address a dry run simulates from. It is required while writes are off. While
  they are on, the signer's address is used, and a different `from` is refused.
- `validators_show` (its delegators count), `withdrawals_list` without `address`, and
  `rewards_history` scan the chain's history and need an archive RPC endpoint.

A result is structured content: the same JSON as `safenet <command> --json`. The text content
holds a one or two sentence summary, then the same JSON, for clients that pass only text to the
model. A write's result is `{ writesAllowed, dryRunForced, dryRun, execution }`: the dry run
always, and the execution after it when the write was sent. An error is one sentence.

## Settings

The server reads these environment variables when it starts.

| Variable | What it sets |
|---|---|
| `SAFENET_MCP_RPC_URL` | The Mainnet RPC endpoint |
| `MAINNET_RPC_URL` | The endpoint when `SAFENET_MCP_RPC_URL` is not set. Without either, public endpoints are used, which refuse history scans |
| `GITHUB_TOKEN` or `GH_TOKEN` | Raises the GitHub API limit for the lookup that dates SEF's participation window. Optional |
| `SAFENET_MCP_ALLOW_WRITES` | `1` allows writes when a signer is also set. Anything else but `0` or nothing stops the server |
| `SAFENET_MCP_PRIVATE_KEY_ENV` | The **name** of a variable that holds the private key |
| `SAFENET_MCP_KEYSTORE` | The path of a version 3 keystore file, instead of a key |
| `SAFENET_MCP_PASSWORD_ENV` | The **name** of a variable that holds the keystore's password |

The signer settings take names, never secrets: a value that looks like a key is refused, and no
message repeats it. While writes are off, the signer is not loaded at all.

The server logs where the endpoint comes from, never the URL, which can carry a key.

## Claude Desktop

Add the server to `claude_desktop_config.json`. On macOS it is in
`~/Library/Application Support/Claude/`; on Windows, in `%APPDATA%\Claude\`. Restart Claude Desktop.

```json
{
  "mcpServers": {
    "safenet": {
      "command": "npx",
      "args": ["-y", "@cobuilders/safenet-mcp"],
      "env": {
        "MAINNET_RPC_URL": "<your archive RPC endpoint>"
      }
    }
  }
}
```

Many RPC providers put the API key in the URL. Do not paste such a URL into the config: start the
server through a wrapper that sets `MAINNET_RPC_URL` or `SAFENET_MCP_RPC_URL` from a secret
manager, as described below for the signer, or leave it to the environment the client inherits.

The package is not on npm yet. Until it is, build it from this repository and point `command` at
the bundle:

```sh
pnpm install && pnpm --filter @cobuilders/safenet-mcp build
```

```json
{
  "mcpServers": {
    "safenet": {
      "command": "node",
      "args": ["/absolute/path/to/safenet-staking/packages/mcp/dist/index.js"],
      "env": {
        "MAINNET_RPC_URL": "<your archive RPC endpoint>"
      }
    }
  }
}
```

The config file is plain text. Do not put a private key or a password in it. To allow writes,
start the server through a wrapper that takes the secret from a secret manager and sets
`SAFENET_MCP_ALLOW_WRITES`, `SAFENET_MCP_PRIVATE_KEY_ENV` (or `SAFENET_MCP_KEYSTORE` and
`SAFENET_MCP_PASSWORD_ENV`) and the variable they name, and put the wrapper in `command`.

## Cursor

Add the same stanza to `~/.cursor/mcp.json` for every project, or to `.cursor/mcp.json` in one
project:

```json
{
  "mcpServers": {
    "safenet": {
      "command": "npx",
      "args": ["-y", "@cobuilders/safenet-mcp"],
      "env": {
        "MAINNET_RPC_URL": "<your archive RPC endpoint>"
      }
    }
  }
}
```

Then open Cursor's MCP settings and check that `safenet` lists eleven tools. The same advice on
secrets applies, to an RPC URL that carries a key as to a signer: a project's `.cursor/mcp.json`
is often committed.

## Requirements

Node.js 22.14 or later.
