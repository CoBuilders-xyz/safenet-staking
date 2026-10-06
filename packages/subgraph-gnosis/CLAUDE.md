# packages/subgraph-gnosis

Consensus and signing on Gnosis Chain. The manifest and ABIs are generated from `packages/core`;
the root `CLAUDE.md` explains why and lists the commands.

## Deploy to Studio

```
pnpm --filter @cobuilders/safenet-subgraph-gnosis deploy:studio
```

It generates the manifest with `--days 16`, runs `codegen` and `build`, then runs
`tools/deploy-studio.mjs safenet-gnosis`. The Studio slug is `safenet-gnosis`. The version label
is the short git SHA, with `-dirty` when the tree has uncommitted changes; set `VERSION_LABEL` to
override it.

Why 16 days and not the full history: the full history is about 15 million logs, which takes an
indexer far longer to sync. The Network Overview reads a 14-day window and drops the partial first
day, so 16 days cover it with a day to spare. The start block is fixed when the manifest is
generated, so the deployment keeps every block from then on; it does not roll. A windowed
deployment cannot answer validator registration history or the epoch record. Those need `--full`,
as a separate deployment.

The deploy key is `GRAPH_DEPLOY_KEY`. Locally it comes from `.env.local` (`pnpm env:pull`), which
the script reads itself. In CI it is the secret of the same name, and
`.github/workflows/subgraphs-deploy.yml` deploys on a manual run. The key never goes on a command
line or into `~/.graph-cli.json`: `tools/deploy-studio.mjs` explains how.

Check indexing by deployment hash, not by name: the name can still answer from the previous
version. A deploy retires older version labels of the slug, so the same change moves this
chain's default query URL in `packages/core/src/subgraphs.ts`; the web app and the parity run
read it from there.

To compare a deployed version with the oracle, generate the oracle over the same window and point
the differential at the query URL:

```
cd packages/core && node --env-file-if-exists=../../.env.local --import tsx \
  scripts/metrics-poc.ts --days 16 --json /tmp/oracle-16d.json
ORACLE=/tmp/oracle-16d.json ORACLE_DAYS=16 SUBGRAPH_URL=<studio query URL> \
  pnpm --filter @cobuilders/safenet-subgraph-gnosis differential
```

The comparison only holds shortly after a deploy. Once the deployment has indexed past its
16 days, its counts cover more than the oracle's window.

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
