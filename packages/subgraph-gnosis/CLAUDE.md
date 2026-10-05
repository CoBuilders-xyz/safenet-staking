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
indexer far longer to sync. The Network Overview, when it lands, is expected to read a 14-day
window and drop the partial first day, so 16 days would cover it with a day to spare. The start
block is fixed when the manifest is generated, so the deployment keeps every block from then on;
it does not roll. A windowed deployment cannot answer validator registration history or the epoch
record. Those need `--full`, as a separate deployment.

The deploy key is `GRAPH_DEPLOY_KEY`. Locally it comes from `.env.local` (`pnpm env:pull`), which
the script reads itself. In CI it is the secret of the same name, and
`.github/workflows/subgraphs-deploy.yml` deploys on a manual run. The key never goes on a command
line or into `~/.graph-cli.json`: `tools/deploy-studio.mjs` explains how.

Check indexing by deployment hash, not by name: the name can still answer from the previous
version.

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

## Parity with SEF

```
SUBGRAPH_URL_GNOSIS=<query URL> pnpm --filter @cobuilders/safenet-subgraph-gnosis test:parity
```

`scripts/parity.ts` compares each validator's participation with `participation_rate_14d` in
SEF's `validator-info.json`, at the commit that last wrote the file. The window is SEF's: 14 days
ending at the top of that hour, both ends included, by the block the ceremony completed in. The
subgraph's `attended` and `attestationCeremonies` counters move in that block, so each counter
after the window's last block minus the same counter after the block before its first is SEF's
numerator and denominator. The rate is the same division, and is compared as the identical
double.

That needs `block: { number }` 14 days back. Studio keeps about 1,000 blocks of history, about
1.4 hours here, so against Studio the run reports NOT COMPARABLE, exits 0, and says why in one
line. A real difference, when the comparison is possible, still fails. It can pass only against a
deployment that keeps its history from at least 14 days and 200 blocks back, such as the local
graph-node after `pnpm generate --days 16` and a full sync. Studio reported `historyBlocks: 1000` on
2026-10-05, though the manifest sets no `indexerHints`.

The daily buckets cannot stand in for the history. `ValidatorDay` and `ConsensusDay` file a
ceremony under the day of its first share, while SEF counts it on the day it completed, and
SEF's window ends on the hour, not at midnight.

