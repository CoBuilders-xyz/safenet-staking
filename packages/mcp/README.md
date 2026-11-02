# safenet-mcp

An [MCP](https://modelcontextprotocol.io) server for Safenet staking on Ethereum Mainnet.
It gives an AI client the reads of the `safenet` command-line interface, and its writes as dry
runs. It talks over stdio.

Each tool returns the figures with their source: `chain: Contract.call()` or `SEF: file field`.
Amounts are exact, in wei, as decimal strings.

Writes are off by default. A write tool then simulates the transactions and returns what would be
sent, and signs nothing. The operator can allow writes when the server starts; a model can never
turn them on, and no key or password ever goes through a tool.

## Tools

| Tool | Arguments | Kind |
|---|---|---|
| `status` | none | read |
| `validators_list` | `active` (boolean), `all` (boolean), `sort` (`"stake"` or `"participation"`, default `"stake"`). A rate SEF does not publish is `null` | read |
| `validators_show` | `address`. A rate SEF does not publish is `null` | read |
| `withdrawals_list` | `address` (optional: one staker's queue; without it, the network total and count) | read |
| `rewards_check` | `address` | read |
| `rewards_history` | `address`, `all` (boolean: every claim, not only the newest 20) | read |
| `stake` | `validator`, `amount` (SAFE, such as `"100"` or `"0.5"`), `approve` (`"exact"` or `"unlimited"`, default `"exact"`), `dryRun`, `from` | write |
| `unstake` | `validator`, `amount`, `dryRun`, `from` | write |
| `withdrawals_claim` | `id` (claims up to and including it) or `all` (boolean), `dryRun`, `from` | write |
| `rewards_claim` | `dryRun`, `from` | write |
| `rewards_claim_and_stake` | `validator`, `amount` (optional), `approve`, `dryRun`, `from` | write |

Each tool mirrors the `safenet` command of the same name: `validators_list` is
`safenet validators list`, `rewards_claim_and_stake` is `safenet rewards claim-and-stake`. The
[command reference](https://github.com/CoBuilders-xyz/safenet-staking/blob/main/packages/cli/docs/commands.md) describes each command, and its `--json` sample is the
structured content the tool returns.

- `dryRun` defaults to `true`, and is forced to `true` unless writes are allowed (see below).
- `from` is the address a dry run simulates from. It is required while writes are off. While
  they are on, the signer's address is used, and a different `from` is refused.
- Every write passes the compliance gates of `safenet` before anything is signed, dry runs
  included: the sanctions oracle on chain always, and the sanctions endpoint and the geo check
  when the operator sets them (see Settings). They are settings, not tool arguments, so a model
  cannot skip a gate or point the server at a URL of its choosing. A refused gate is a tool error
  with one sentence, and the report as structured content, `{ refused: true, compliance }`. The
  safenet-cli README's "Compliance gates" section describes each gate.
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
| `IPFS_GATEWAY` | An IPFS gateway, tried before the public gateways for SEF's reward dataset. Only its origin is used. Optional |
| `GRAPH_API_KEY` | Optional runtime Graph Network key. Full `SUBGRAPH_URL_MAINNET` wins; without either, use new-account Studio. Never printed. |
| `SUBGRAPH_URL_MAINNET` | The Mainnet subgraph `rewards_history` reads its periods from, instead of the default Studio deployment. Optional |
| `SAFENET_MCP_SANCTIONS_ENDPOINT` | A URL every write GETs first, refusing on 403 or any failure. Never printed. Optional |
| `SAFENET_MCP_GEO_CHECK` | `1` refuses every write while this machine's IP is in a country the web interface blocks. Optional |
| `SAFENET_MCP_ALLOW_WRITES` | `1` allows writes when a signer is also set. Anything else but `0` or nothing stops the server |
| `SAFENET_MCP_PRIVATE_KEY_ENV` | The **name** of a variable that holds the private key |
| `SAFENET_MCP_KEYSTORE` | The path of a version 3 keystore file, instead of a key |
| `SAFENET_MCP_PASSWORD_ENV` | The **name** of a variable that holds the keystore's password |

The signer settings take names, never secrets: a value that looks like a key is refused, and no
message repeats it. While writes are off, the signer is not loaded at all. With writes allowed
through `SAFENET_MCP_PRIVATE_KEY_ENV`, the server says at start that a keystore is safer: it keeps
the key encrypted on disk.

The server logs where the endpoint comes from, never the URL, which can carry a key.

Reward files come from SEF's IPFS dataset behind `rewards.safenet-gov.eth` when the name is set,
then from the repository mirror; `status` and `rewards_check` report which, in the order and with
the fields the "Reward data" section of the safenet-cli README describes.

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

## Recorded session

This historical transcript is preserved from revision `73de947ba1f2f7ab9cd74331ee9900c5114bff77`.
It predates #71's ENSIP-10 fix. Its wildcard-resolver `unsupported` result is historical.
Current code follows ENSIP-10 and tries the IPFS dataset before the repository mirror.
The transcript is not evidence of a run of the current revision.

One session with the server over stdio, against Ethereum Mainnet at block 26,286,992 on
2026-10-27, with Node.js 22.14.0. The server was started as this Claude Desktop config starts it:
the same command, arguments and environment. The client was a script on the MCP SDK's own client,
not Claude Desktop, so the transcript shows the messages a desktop client exchanges with the
server, without a model choosing the calls. A video may be added later.

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

The server wrote one line on stderr, its settings at start:

```text
safenet-mcp: RPC from MAINNET_RPC_URL first, then the public list; writes off, every write is a dry run.
```

The client initialized the session, listed the tools, and called `status`, then
`validators_list` with no arguments. Below is every JSON-RPC message, in order. Three things are
shortened: `tools/list` keeps each tool's name and description and leaves out its schemas; each
tool result's second text block, which repeats the structured content as JSON text, is a
placeholder; and validator addresses are labels, as in the
[command reference](https://github.com/CoBuilders-xyz/safenet-staking/blob/main/packages/cli/docs/commands.md#how-to-read-the-samples).

<details>
<summary>The transcript</summary>

```jsonc
// client → server
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "recorded-session",
      "version": "1.0.0"
    }
  },
  "jsonrpc": "2.0",
  "id": 0
}

// server → client
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "safenet-mcp",
      "title": "Safenet",
      "version": "0.0.0"
    },
    "instructions": "Reads Safenet staking on Ethereum Mainnet and the data SEF publishes. Every figure carries its source. Amounts are wei as decimal strings, with SAFE amounts as decimal strings next to them in write results. Writes are off: every write tool returns a dry run, simulated from the address in from, and signs nothing."
  }
}

// client → server
{
  "method": "notifications/initialized",
  "jsonrpc": "2.0"
}

// client → server
{
  "method": "tools/list",
  "jsonrpc": "2.0",
  "id": 1
}

// server → client
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "status",
        "description": "Network totals on Ethereum Mainnet: stake, validators, pending withdrawals, rewards and the Merkle root, each with its source."
      },
      {
        "name": "validators_list",
        "description": "Every validator SEF lists, with stake and registration from the chain and participation, commission and active from SEF. Participation is null when SEF publishes no rate, never 0."
      },
      {
        "name": "validators_show",
        "description": "One validator, with its delegators count. The count needs an archive RPC endpoint; without one it is marked unavailable. Participation is null when SEF publishes no rate, never 0."
      },
      {
        "name": "withdrawals_list",
        "description": "Pending withdrawals: the network total and count, or one staker's queue when address is given. The network count needs an archive RPC endpoint."
      },
      {
        "name": "rewards_check",
        "description": "An address's rewards: earned, claimed, claimable and held amounts, and whether SEF's proof matches the root on chain."
      },
      {
        "name": "rewards_history",
        "description": "An address's reward claims, newest first, the newest 20 unless all is true. Needs an archive RPC endpoint."
      },
      {
        "name": "stake",
        "description": "Stake SAFE on a validator, approving the staking contract first when the allowance is short. This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
      },
      {
        "name": "unstake",
        "description": "Start a withdrawal of SAFE staked on a validator. It becomes claimable after the delay. This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
      },
      {
        "name": "withdrawals_claim",
        "description": "Claim withdrawals past their delay. claimWithdrawal() pays the oldest first, so an id claims every one up to it. This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
      },
      {
        "name": "rewards_claim",
        "description": "Claim the signer's rewards with SEF's published proof, while its root is the root on chain. This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
      },
      {
        "name": "rewards_claim_and_stake",
        "description": "Claim the signer's rewards, then approve and stake what arrived on a validator, one transaction after another. This server runs dry runs only: dryRun is forced to true, nothing is signed, and from is required."
      }
    ]
  }
}

// client → server
{
  "method": "tools/call",
  "params": {
    "name": "status",
    "arguments": {}
  },
  "jsonrpc": "2.0",
  "id": 2
}

// server → client
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Safenet at Ethereum Mainnet block 26286992: 69560833.162022313723058414 SAFE staked, 4 active validators, 5924343.977566872354969673 SAFE in pending withdrawals. The Merkle root on chain matches the one in SEF's latest.json."
      },
      {
        "type": "text",
        "text": "<the same JSON as structuredContent>"
      }
    ],
    "structuredContent": {
      "block": "26286992",
      "totalStaked": {
        "value": "69560833162022313723058414",
        "source": "chain: Staking.totalStakedAmount()"
      },
      "totalStakedPublished": {
        "value": "69560688211255109215240029",
        "source": "SEF: network-info.json total_staked_amount, a snapshot published every 3 hours"
      },
      "activeValidators": {
        "value": 4,
        "source": "SEF: validator-info.json is_active"
      },
      "registeredValidators": {
        "value": {
          "registered": 5,
          "listed": 6
        },
        "source": "chain: Staking.isValidator() for each address in SEF's validator-info.json"
      },
      "pendingWithdrawals": {
        "value": "5924343977566872354969673",
        "source": "chain: Staking.totalPendingWithdrawals()"
      },
      "rewardsAllocated": {
        "value": "4499987774807670271201970",
        "source": "SEF: rewards/latest.json tokenTotal"
      },
      "rewardsEpoch": {
        "value": {
          "epoch": 0,
          "rewardsUntil": "2026-10-06T00:00:00.000Z"
        },
        "source": "SEF: rewards/latest.json epoch, rewardsUntil"
      },
      "rewardsUnclaimed": {
        "value": "308516417160356008138174",
        "source": "chain: SAFE.balanceOf(MerkleDrop), while its root is the published one"
      },
      "merkleDropBalance": {
        "value": "308516417160356008138174",
        "source": "chain: SAFE.balanceOf(MerkleDrop)"
      },
      "merkleRoot": {
        "onChain": {
          "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
          "source": "chain: MerkleDrop.merkleRoot()"
        },
        "published": {
          "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
          "source": "SEF: rewards/latest.json merkleRoot"
        },
        "match": true
      },
      "rewardsSource": {
        "kind": "repository",
        "url": "<redacted-url>",
        "gateway": null,
        "tried": [
          {
            "kind": "repository",
            "url": "<redacted-url>",
            "gateway": null,
            "outcome": "found",
            "reason": null
          }
        ],
        "ens": {
          "name": "rewards.safenet-gov.eth",
          "status": "unsupported",
          "contenthash": null,
          "reason": "the name is served by a parent's wildcard resolver"
        }
      }
    }
  }
}

// client → server
{
  "method": "tools/call",
  "params": {
    "name": "validators_list",
    "arguments": {}
  },
  "jsonrpc": "2.0",
  "id": 3
}

// server → client
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "4 validators, active only, sorted by stake, at Ethereum Mainnet block 26286992. Participation covers 14 days."
      },
      {
        "type": "text",
        "text": "<the same JSON as structuredContent>"
      }
    ],
    "structuredContent": {
      "block": "26286992",
      "filter": "active",
      "sort": "stake",
      "window": {
        "days": 14,
        "start": "2026-10-13T22:00:00.000Z",
        "end": "2026-10-27T22:00:00.000Z",
        "publishedAt": "2026-10-27T22:18:42.000Z",
        "commit": "78970fb6333a9d193a095bd1df10e70d2f33ffa8"
      },
      "totalStaked": {
        "value": "69560833162022313723058414",
        "source": "chain: Staking.totalStakedAmount()"
      },
      "validators": [
        {
          "address": "<validator Gnosis>",
          "label": "Gnosis",
          "active": true,
          "registered": true,
          "commission": 0.05,
          "stake": "19992282134777049144328363",
          "share": 0.287407169,
          "participation": 1
        },
        {
          "address": "<validator Core Contributors>",
          "label": "Core Contributors",
          "active": true,
          "registered": true,
          "commission": 0.05,
          "stake": "15626677613413900683879347",
          "share": 0.224647648,
          "participation": 0.9978902953586498
        },
        {
          "address": "<validator Safe Labs>",
          "label": "Safe Labs",
          "active": true,
          "registered": true,
          "commission": 0.05,
          "stake": "14644357805936637363943797",
          "share": 0.210525911,
          "participation": 1
        },
        {
          "address": "<validator Greenfield>",
          "label": "Greenfield",
          "active": true,
          "registered": true,
          "commission": 0.05,
          "stake": "13477385100802047047713745",
          "share": 0.193749621,
          "participation": 1
        }
      ],
      "sources": {
        "label": "SEF: validator-info.json label",
        "active": "SEF: validator-info.json is_active",
        "registered": "chain: Staking.isValidator()",
        "commission": "SEF: validator-info.json commission",
        "stake": "chain: Staking.totalValidatorStakes()",
        "share": "chain: Staking.totalValidatorStakes() / Staking.totalStakedAmount()",
        "participation": "SEF: validator-info.json participation_rate_14d"
      }
    }
  }
}
```

</details>

To make one call the same way from a clone, with the endpoint in `.env.local`:

```sh
pnpm --filter @cobuilders/safenet-mcp client status
```

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

For gateway subgraph restrictions, the USD 20/month cap, fallback behavior and operator setup, see [GRAPH-GATEWAY.md](https://github.com/CoBuilders-xyz/safenet-staking/blob/main/GRAPH-GATEWAY.md). Supply `GRAPH_API_KEY` through the process environment; no command-line key flag is needed.

Failed Network queries retry Studio once. The process warns on stderr once per chain; if both fail, history reports unavailable without leaking URLs.
