# packages/core

The only place in this repository where a contract address, a start block, or an event signature
is written. Everything else imports from here.

## Why it exists

Agents hallucinate constants that look right. A wrong address produces an indexer that silently
returns nothing, and a wrong event signature produces exactly the same silence. Keeping every
constant in one typed module, continuously verified against the chain, removes that whole class of
error rather than catching it later.

## The rule about ABIs

The deployed Safenet contracts match **neither** published branch of `safe-research/safenet`. The
`beta` tag is older than what is deployed; `main` is newer. So:

- Never take an event signature from a git branch.
- `pnpm verify:abis` recomputes keccak topic0 for every entry in `src/abis.ts` and asserts the
  chain still emits it.
- If it fails, the contract was probably redeployed. Recover the real signature from chain data,
  update `src/abis.ts`, and tell the team. Do not guess, and do not read a branch.

Custom errors and functions emit no log, so they are proven differently: every run checks that
the 4-byte selector of each error in `DECODED_ERRORS` and of each function in the staking,
MerkleDrop, ERC-20 and sanctions ABIs is in the deployed bytecode. `src/abis.ts` also records the
`eth_call` or fork run that proved each error and each newer read.

Events are tagged `high` or `rare`. High-frequency events are proven by a recent window and run
on every pull request. When an event has no log in that window, the scan widens back in doubling
steps up to a ceiling per chain, so a quiet weekend does not fail every pull request. Rare events
need `--deep`, which scans from the deploy block and runs nightly, because even the ceiling
legitimately contains none of them.

## Files

- `src/chains.ts` — chain config and RPC fallback order. Several endpoints per chain on purpose:
  the reference interface reads the chain through one hardcoded URL and goes blank when it fails.
- `src/contracts.ts` — addresses, deploy blocks, and where SEF publishes the data our numbers must
  match.
- `src/abis.ts` — the indexed event registry, `indexedEvent()` to look one up by name, the
  decoded error registry, and the ABIs built from them.
- `src/sef.ts` — the shapes of SEF's published files, the URL of an address's reward proof, and
  the window a published participation rate covers.
- `src/deployments.ts` — what the interface needs per chain, derived from `src/contracts.ts`.
- `src/parity/` — the comparison behind `pnpm test:parity`, which both subgraph packages share.
  `compare.ts` holds the rules as pure functions: exact and declared-precision comparison, the
  stale rule, the publish instant, the staked total rewound through its movements, and SEF's
  participation window summed from the Gnosis subgraph's hourly rows. `blocks.ts`
  finds the block at an instant. `sources.ts` reads SEF's files at a commit, the subgraphs and
  the RPC. It is exported as `@cobuilders/safenet-core/parity`, not from the main entry, because
  `sources.ts` reads the environment and runs `gh`, and the browser app imports the main entry.
- `src/fork.ts` — the Mainnet block both fork suites fork from, pinned together with the commit of
  SEF's data it reads. A test fixture: move the two together.
- `scripts/verify-abis.ts` — the check itself.
- `scripts/verify-abis-scan.ts` — the per-event scans, the window and the ceiling, taking the
  client as an argument so `verify-abis-scan.test.ts` runs them against a mocked `getLogs`.

## Adding a contract or an event

1. Add it to `src/contracts.ts` or `src/abis.ts`, with a comment naming where you got it.
2. Run `pnpm verify:abis`. A new event producing no logs is not verified. Mark it `rare` and prove
   it with `--deep` before anything depends on it.
3. Keep the export surface to constants, ABIs, and small accessors that only look a constant up
   or derive a location from it, such as `indexedEvent()` or `rewardProofUrl()`. No business
   logic lives here, because every other package imports this one and nothing should import them
   back. The one exception is `src/parity/`, behind its own export: both subgraph packages need
   the same comparison, and it imports nothing from them.
