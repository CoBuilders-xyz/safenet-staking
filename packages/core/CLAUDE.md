# packages/core

The only place in this repository where a contract address, a start block, an event signature,
or a programme date is written. Everything else imports from here.

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
- `ensUniversalResolverAbi` and `ensResolverAbi` are the exception: standard ENS interfaces,
  the Universal Resolver's `findResolver` and ENSIP-7's `contenthash`, read only to find SEF's
  reward dataset. They are outside the Safenet check, in neither `INDEXED_EVENTS` nor the
  bytecode scan; the CLI smoke test reads them on Mainnet nightly.

Custom errors and functions emit no log, so they are proven differently: every run checks that
the 4-byte selector of each error in `DECODED_ERRORS` and of each function in the staking,
MerkleDrop, ERC-20 and sanctions ABIs is in the deployed bytecode. `src/abis.ts` also records the
`eth_call` or fork run that proved each error and each newer read.

Events are tagged `high` or `rare`. High-frequency events are proven by a recent window and run
on every pull request. When an event has no log in that window, the scan widens back in doubling
steps up to a ceiling per chain, so a quiet weekend does not fail every pull request. Rare events
need `--deep`, which scans from the deploy block and runs nightly, because even the ceiling
legitimately contains none of them. Since 2026-10-23, a contract whose `programme` in
`src/contracts.ts` is closed by `PROGRAMME_CLOSED_FROM` in `src/sef.ts`, today the Gnosis Beta
contracts, is scanned back from the last block before the close, found by timestamp at run time,
because it will never log that programme's events again and a scan from the head only finds silence.

## Files

- `src/chains.ts` — chain config and RPC fallback order. Several endpoints per chain on purpose:
  the reference interface reads the chain through one hardcoded URL and goes blank when it fails.
- `src/contracts.ts` — addresses, deploy blocks, and where SEF publishes the data our numbers must
  match.
- `src/abis.ts` — the indexed event registry, `indexedEvent()` to look one up by name, the
  decoded error registry, and the ABIs built from them; also `ensUniversalResolverAbi` and
  `ensResolverAbi`, the two standard ENS reads `src/rewards-source.ts` makes.
- `src/sef.ts` — the shapes of SEF's published files, the paths of the reward files under a
  rewards data base, the window a published participation rate covers, and the programme
  calendar: the Beta end, the Aegis start, the reward period and the participation threshold,
  with `programmePhase()` to place a UTC day in Beta, the gap or Aegis; and
  `GNOSIS_INDEXED_PROGRAMME`, the programme whose contracts the Gnosis subgraph indexes.
- `src/rewards-source.ts` — where reward data is read from. The ENS name SEF declares canonical,
  `SEF_REWARDS_ENS_NAME`, and the public gateways, `IPFS_GATEWAYS`, live here and nowhere else.
  It resolves the name's contenthash, lists the bases to try, the IPFS dataset through each
  gateway and then the repository mirror, and reads a file from the first base that answers. A
  file is absent only when the repository, or a configured override, answers 404: the dataset's
  layout under the contenthash is assumed to repeat the repository's `assets/rewards` until SEF
  confirms it, so a 404 from a gateway proves nothing. The gateway comment records how each
  gateway was checked, and why ipfs.io and dweb.link are not listed: both retired.
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
- `src/subgraphs.ts` — the default query endpoint per chain, today the Studio deployments, and the
  only place that knows their URLs; the subgraph names and the local graph-node URL; and the
  staleness threshold every subgraph consumer applies. A Studio deploy retires older version
  labels, so a deploy moves that chain's default here in the same change. Studio's query URL is
  rate-limited to about 3,000 queries a day per subgraph and is not the production read path.
- `src/gnosis-snapshot.ts` — one dated `pnpm metrics` run of the Gnosis figures, kept here because
  it carries validator addresses. Shown only when the Gnosis subgraph is not live.
- `scripts/verify-abis.ts` — the check itself.
- `scripts/verify-abis-scan.ts` — the per-event scans, the window, the ceiling and the anchor of a
  closed programme, taking the client as an argument so `verify-abis-scan.test.ts` runs them
  against a mocked `getLogs` and `getBlock`.

## Adding a contract or an event

1. Add it to `src/contracts.ts` or `src/abis.ts`, with a comment naming where you got it.
2. Run `pnpm verify:abis`. A new event producing no logs is not verified. Mark it `rare` and prove
   it with `--deep` before anything depends on it.
3. Keep the export surface to constants, ABIs, and small accessors that only look a constant up
   or derive a location from it, such as `indexedEvent()` or `rewardProofUrl()`. No business
   logic lives here, because every other package imports this one and nothing should import them
   back. The exceptions are `src/parity/`, behind its own export: both subgraph packages need
   the same comparison, and it imports nothing from them; and `src/rewards-source.ts`, because
   the interface and the CLI must try SEF's reward sources in the same order. It reads the chain
   and fetches only through what its caller passes in.
