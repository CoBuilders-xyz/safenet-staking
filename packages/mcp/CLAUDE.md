# packages/mcp

`safenet-mcp`, an MCP server for Safenet over stdio: one tool per `safenet` command, eleven
in all. It calls the CLI's library, `@cobuilders/safenet-cli/lib`, not the binary. Reads are
reads. Writes are dry runs unless the operator allows them when the server starts. Every address,
start block, event, function and error comes from `@cobuilders/safenet-core` through the library;
none is typed here.

## Layout

- `src/tools.ts`: the tool definitions. Each names its CLI command, takes the command's arguments
  and options under the same names in camel case, validates them with a zod schema, and calls one
  library function. The JSON Schema a client sees is the input side of that schema,
  `z.toJSONSchema(schema, { io: "input" })`.
- `src/server.ts`: the protocol handlers on the SDK's low-level `Server`. It lists the tools,
  checks each call's arguments, runs the write gate, and shapes the result and the errors.
- `src/config.ts`: the settings, read from the environment once at start. A bad setting stops the
  server with exit code 2 and one sentence on stderr.
- `src/signer.ts`: the only place a key is touched.
- `src/summary.ts`: the short text that goes with each result.
- `src/library.ts`: the library functions the server calls, as one object, so tests hand it a fake.
- `src/index.ts`: reads the settings and connects the server to stdio. stdout is the protocol;
  everything else goes to stderr.
- `scripts/client.ts`: calls one tool over stdio with the SDK's client, for a manual check.

## Tools

| Tool | Arguments | Kind |
|---|---|---|
| `status` | none | read |
| `validators_list` | `active?`, `all?`, `sort?` | read |
| `validators_show` | `address` | read |
| `withdrawals_list` | `address?` | read |
| `rewards_check` | `address` | read |
| `rewards_history` | `address`, `all?` | read |
| `stake` | `validator`, `amount`, `approve?`, `dryRun?`, `from?` | write |
| `unstake` | `validator`, `amount`, `dryRun?`, `from?` | write |
| `withdrawals_claim` | `id?`, `all?`, `dryRun?`, `from?` | write |
| `rewards_claim` | `dryRun?`, `from?` | write |
| `rewards_claim_and_stake` | `validator`, `amount?`, `approve?`, `dryRun?`, `from?` | write |

The CLI's global options are settings here, not arguments: the RPC endpoint is an environment
variable, and every result is already the `--json` document. The CLI's signer options are settings
too, and no tool takes one. A new CLI command needs a tool: `src/parity.test.ts` fails otherwise.

## The write gate

- Every write tool takes `dryRun`, default `true`. It is forced to `true` unless the server was
  started with `SAFENET_MCP_ALLOW_WRITES=1` and a signer: `SAFENET_MCP_PRIVATE_KEY_ENV=<NAME>`, or
  `SAFENET_MCP_KEYSTORE=<path>` with `SAFENET_MCP_PASSWORD_ENV=<NAME>`. A forced call says so in its
  summary and in `dryRunForced`.
- While writes are off, the signer is never loaded, even when signer settings are present, and a
  dry run needs `from`. While they are on, the dry run simulates from the signer's address, and a
  `from` that differs is refused, as the CLI refuses `--from` with a signer.
- A write always runs as a dry run first. With `dryRun: false` and writes on, the live run follows,
  and the result holds both: `{ writesAllowed, dryRunForced, dryRun, execution }`. Each section is
  what the CLI prints with `--json`, with and without `--dry-run`.
- Live writes run one at a time, so two calls never race for a nonce. Each transaction's hash goes
  to stderr as it is sent and when it confirms.
- Signing works as in the CLI: a private key from the variable the operator named, or a version 3
  keystore decrypted with the password from the variable named for it. There is no prompt: stdin
  is the protocol. Interactive WalletConnect is CLI-only; no tool receives pairing or signer flags.
  Environment-key configuration emits an exposure warning at server startup.
  While writes are on, the key is loaded for every write call, dry runs
  included, because a dry run simulates from the signer's address; it is kept nowhere between
  calls. While writes are off, it is never loaded.

## Rules the server keeps

- No message repeats a setting's value: not a key, a password, a variable name or a keystore
  path, any of which could be a secret typed in the wrong place. It names the setting instead.
- No key or password goes through a tool. A string argument, or an argument name, that holds 64
  hex digits is refused, as is any unknown argument whose name suggests a signer setting. No
  validation message repeats the value it refuses; each names the argument instead. An unknown
  argument is counted, never named, and the message lists the arguments the tool takes.
- A result is structured content, the CLI's `--json` document, plus two text blocks: a one or two
  sentence summary, then the same JSON for clients that pass only text to the model.
- A failure is a tool error with one sentence: `errorSentence()` from the library, with the
  server's advice for a refused log scan, then `scrubSecrets()`. No stack, no URL.
- An RPC URL can carry a key. The server logs where the endpoint comes from, never the URL or its
  host.
- RPC: `SAFENET_MCP_RPC_URL`, else `MAINNET_RPC_URL`, else core's public list, through the
  library's `createContext()`. `validators_show` (delegators), `withdrawals_list` without
  `address` and `rewards_history` scan history and need an archive endpoint.

## Tests

`pnpm test` runs `src/`, against a fake library and a client connected in memory. No network.

- `src/parity.test.ts` builds the CLI's program with `buildProgram()` and walks its commands: one
  tool per command, the same arguments and options, the same required ones, flags as booleans.
- `src/server.test.ts` checks that each tool calls its library function with the parsed arguments,
  and the write gate: with writes off, `dryRun: false` reaches the library as a dry run and a
  tripwire signer, whose `send` throws, is neither loaded nor reached. The control test turns
  writes on and shows the same tripwire fires. It also checks that a key or a password passed in
  an argument is refused without being repeated, and that errors carry no URL.
- `src/config.test.ts` checks the settings and the signer loader, with the CLI's keystore fixture.

`pnpm test:smoke` runs `src/smoke/`: it starts the server over stdio as a child process and calls
`status` and `validators_list` against Mainnet. It reads `MAINNET_RPC_URL` from `.env.local` and
skips, with the reason, without it. Under the root `pnpm test` it always skips; the nightly
workflow runs it next to the CLI smoke tests.

`pnpm demo <staker> <claimant>` records one session over stdio against Mainnet, `status`,
`validators_list`, `rewards_check` and a dry-run `stake`, and writes `docs/demo.svg`, an animated
terminal of each call and the summary returned. `scripts/demo-svg.ts` lays it out and redacts every
address to a label, every 32-byte value and every URL; `scripts/demo-svg.test.ts` checks that, and
that the committed SVG carries no address. `pnpm test` runs `scripts/` as well as `src/`.
`docs/claude-desktop.md` is the integration guide.

`pnpm client <tool> '<json arguments>'` runs one call through the SDK's client, with this shell's
environment; `pnpm client --list` lists the tools.

## Build and publish

`pnpm build` bundles `dist/index.js` with tsup. The CLI's library and core are bundled in from
their TypeScript through the `source` condition, so the published package depends only on the
SDK, `viem` and `zod`, which stay external. `files` ships the bundle and the README, and npm
adds the LICENSE by itself; `publishConfig` sets public access. Publishing is a manual step for
the npm owner, and no workflow publishes.
