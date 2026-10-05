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
indexer far longer to sync. The Network Overview reads a 14-day window and drops the partial
first day, so 16 days covers it with a day to spare. The start block is fixed when the manifest
is generated, so the deployment keeps every block from then on; it does not roll. A windowed
deployment cannot answer validator registration history or the epoch record. Those need
`--full`, as a separate deployment.

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
