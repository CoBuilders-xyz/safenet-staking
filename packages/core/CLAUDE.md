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

Events are tagged `high` or `rare`. High-frequency events are proven by a short recent window and
run on every pull request. Rare events need `--deep`, which scans from the deploy block and runs
nightly, because a recent window legitimately contains none of them.

## Files

- `src/chains.ts` — chain config and RPC fallback order. Several endpoints per chain on purpose:
  the reference interface reads the chain through one hardcoded URL and goes blank when it fails.
- `src/contracts.ts` — addresses, deploy blocks, and where SEF publishes the data our numbers must
  match.
- `src/abis.ts` — the indexed event registry and the read-call ABIs.
- `src/fork.ts` — the Mainnet block the fork suite forks from, pinned together with the commit of
  SEF's data it reads. A test fixture: move the two together.
- `scripts/verify-abis.ts` — the check itself.

## Adding a contract or an event

1. Add it to `src/contracts.ts` or `src/abis.ts`, with a comment naming where you got it.
2. Run `pnpm verify:abis`. A new event producing no logs is not verified. Mark it `rare` and prove
   it with `--deep` before anything depends on it.
3. Keep the export surface to constants and ABIs. No business logic lives here, because every
   other package imports this one and nothing should import them back.
