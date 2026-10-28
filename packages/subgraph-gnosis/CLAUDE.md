# packages/subgraph-gnosis

Consensus and signing on Gnosis Chain. The manifest and ABIs are generated from `packages/core`;
the root `CLAUDE.md` explains why and lists the commands.

## Two programmes

One deployment indexes both programmes, each from its own contracts in `GNOSIS_CONTRACTS` in
`packages/core`: Beta, which ended, through the data sources `Consensus` and `FROSTCoordinator`,
and Aegis through `AegisConsensus` and `AegisFROSTCoordinator`. Each mapping file passes its
programme, `"beta"` or `"aegis"`, to the shared handlers in `src/handlers.ts`. Every counting row
carries it in `programme` and starts its id with it, and the `Consensus` row of a programme has
the programme as its id. The two programmes never share a validator list, a ceremony or a
bucket: a validator of both is one `SigningValidator`, listed by each programme from the first
time that programme's contracts show it. So a query for one programme filters on `programme`.

Aegis changed the two transaction events, so each consensus data source has its own mapping;
the coordinator's events are Beta's. Every one of 474 Aegis attestations to 2026-10-27 named the
sid of a `SignCompleted` earlier in the same transaction, as on Beta, so the counting rules below
hold unchanged. They reproduce SEF's Aegis `participation_rate_14d` bit for bit: recomputed from
the logs at SEF's data commit 99963fb, all six validators matched as the identical double.

## Deploy to Studio

```
pnpm --filter @cobuilders/safenet-subgraph-gnosis deploy:studio
```

It generates the manifest with `--days 16`, runs `codegen` and `build`, then runs
`tools/deploy-studio.mjs safenet-gnosis`. The Studio slug is `safenet-gnosis`. The version label
is the short git SHA, with `-dirty` when the tree has uncommitted changes; set `VERSION_LABEL` to
override it.

Aegis always starts at each contract's deploy block: its three weeks to 2026-10-27 held 18,268
logs. `--days 16` applies to Beta only, and starts it 16 days before the end of its last day,
`BETA_END_DAY`, found by timestamp; its data sources run on from there, so a stray ceremony after
the end is still seen. Why not Beta's full history: it is about 15 million logs, which takes an
indexer far longer to sync. The Network Overview reads a 14-day window and drops the partial first
day, so 16 days of Beta cover its history with a day to spare. A windowed deployment cannot answer
Beta's validator registration history or epoch record. Those need `--full`, as a separate
deployment.

The deploy key is `GRAPH_DEPLOY_KEY`. Locally it comes from `.env.local` (`pnpm env:pull`), which
the script reads itself. In CI it is the secret of the same name, and
`.github/workflows/subgraphs-deploy.yml` deploys on a manual run. The key never goes on a command
line or into `~/.graph-cli.json`: `tools/deploy-studio.mjs` explains how.

Check indexing by deployment hash, not by name: the name can still answer from the previous
version. A deploy retires older version labels of the slug, so the same change moves this
chain's default query URL in `packages/core/src/subgraphs.ts`; the web app and the parity run
read it from there.

`metrics-poc.ts` scans Beta's contracts. Use its explicit historical window for the
Beta differential. Today's SEF participation rates describe Aegis and cannot validate Beta.
The oracle's `--beta-window` ends at the end of `BETA_END_DAY`, from core. Generate 14 days
against the deployment's 16 days, leaving two days for ceremonies already in progress:

```sh
(cd packages/core && node --env-file-if-exists=../../.env.local --import tsx \
  scripts/metrics-poc.ts --beta-window --days 14 --json /tmp/oracle-beta.json)
ORACLE=/tmp/oracle-beta.json ORACLE_DAYS=14 SUBGRAPH_URL=<studio-query-url> \
  pnpm --filter @cobuilders/safenet-subgraph-gnosis differential
```

The oracle records both timestamp and block boundaries. Its other metrics still read current
Mainnet state; historical Beta rates are explicitly not compared with current SEF rates.
The differential requires those boundaries and reads every hourly page at one indexed block.
It compares exact attendance and ceremony counts inside that window, including the block at its
end. Later Beta activity does not enter the comparison. Programme membership keeps a validator
with zero attendance in the result. Missing history, indexing errors and incomplete membership
fail the check. This comparison remains valid after the deployment catches up to today's head.

`pnpm test:scripts` runs the offline differential regressions; `pnpm test` includes them.
Aegis is compared with SEF's published rates by `test:parity` after its endpoint switch.

## The buckets

Each attestation ceremony is counted once, in the handler that completes the pair of
`SignCompleted` and `TransactionAttested`, and filed under the block of its `TransactionAttested`
in every bucket: `ConsensusHour` and `ValidatorHour` by the UTC hour, `ConsensusDay` and
`ValidatorDay` by the UTC day. A validator attended when it shared for the winning root before
the count. Every other validator in `Consensus.validators` at the count missed it. The rules are
`metrics-poc.ts`'s, named in `tryCount` in `src/shared.ts`.

An hourly row also counts apart the ceremonies attested in the block exactly on the hour. SEF's
window ends on the hour and includes that block; the schema says how to sum a window.

Over 16 days to block 48,602,061, every one of 70,524 `TransactionAttested` logs sat in the same
transaction as its `SignCompleted`, after it, so filing by the attestation is filing by the
completion. Until this rule, the daily rows filed a ceremony under the day of its first share. Over
the same 16 days the two rules differ by at most 2 ceremonies a day out of 3,000 to 5,500.

A counted ceremony is remembered as a `CountedCeremony` for 1,000 blocks, so a late `SignShared`
or a second `TransactionAttested` for it is ignored rather than opening a row nothing completes.
Neither was seen in those 16 days; the logs cannot show the contract never emits one.

## Parity with SEF

```
SUBGRAPH_URL_GNOSIS=<query URL> pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
```

Without `SUBGRAPH_URL_GNOSIS` it reads the default in `packages/core/src/subgraphs.ts`, today the
Studio deployment. `scripts/parity.ts` compares each validator's participation with
`participation_rate_14d` in SEF's `validator-info.json`, at the commit that last wrote the file.
The window is SEF's: 14 days ending at the top of that hour, both ends included, by the block the
ceremony was attested in. The run sums the hourly rows inside that window from a current query,
with `participationFromHours` in `packages/core`: SEF's numerator and denominator. The rate is the
same division, and is compared as the identical double.

No query reaches back in time, so the result does not depend on the history a deployment keeps.
A deployment built before the hourly buckets has no rows to sum, and the run reports NOT
COMPARABLE, exits 0, and says why in one line. So does a deployment that starts less than 1,000
blocks before the window: a ceremony attested at the window's first block counts shares from
before it. A real difference still fails.

Two more cases are NOT COMPARABLE, with exit 0 and the reason in the job summary, because SEF
gives nothing to compare:

- SEF's window lies after the programme this deployment indexes, `GNOSIS_INDEXED_PROGRAMME` in
  `packages/core`: the window starts after that programme's last day. SEF computes its rates over
  the programme running when it publishes, and from 22 October 2026 that is Aegis, while this
  deployment indexes Beta. `windowOutsideProgramme` in `packages/core/src/parity/compare.ts`
  decides it from the calendar in `src/sef.ts`. It stops applying by itself once
  `GNOSIS_INDEXED_PROGRAMME` names Aegis, which has no last day. A window that still holds an
  hour of Beta is compared as before, and a lagging or broken subgraph still fails.
- SEF lists a validator with `participation_rate_14d: null`. That row reads "SEF publishes no
  rate".

Studio keeps about 1,000 blocks of history: `historyBlocks: 1000` in the indexing status, about
1.4 hours here. `indexerHints: prune: never` does not change that. Measured on 2026-10-05: version
`edc2588-prune-never`, built with `pnpm generate --days 16 --prune-never`, synced 16 days and then
reported `historyBlocks: 1000`, exactly as the same code without the hint did. Both answered from
block 48,601,562 with the head at 48,602,585, and refused a query at block 48,340,000 inside their
own range. So the flag stays off, and nothing here may depend on history Studio keeps.

## Matchstick tests

`tests/events.ts` builds each event's parameters as an array, and the generated bindings read them
by position. Whether a parameter is `indexed` decides where graph-node looks for it in a real log,
in the topics or in the data, and no test here passes through that step. So a wrong `indexed` flag
in the generated manifest passes every matchstick test while the deployed subgraph decodes nothing,
or the wrong values. `pnpm verify:abis` does not catch it either: topic0 does not encode which
parameters are indexed. Only real logs do: a local graph-node sync, or a deployment and its
differential.
