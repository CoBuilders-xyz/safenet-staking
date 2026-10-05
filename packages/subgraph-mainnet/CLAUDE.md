# packages/subgraph-mainnet

Staking, withdrawals and rewards on Ethereum Mainnet. The manifest and ABIs are generated from
`packages/core`; the root `CLAUDE.md` explains why and lists the commands.

## Deploy to Studio

```
pnpm --filter @cobuilders/safenet-subgraph-mainnet deploy:studio
```

It builds (`generate`, `codegen`, `build`), then runs `tools/deploy-studio.mjs safenet-mainnet`.
The Studio slug is `safenet-mainnet`. The version label is the short git SHA, with `-dirty` when
the tree has uncommitted changes; set `VERSION_LABEL` to override it.

The deploy key is `GRAPH_DEPLOY_KEY`. Locally it comes from `.env.local` (`pnpm env:pull`), which
the script reads itself. In CI it is the secret of the same name, and
`.github/workflows/subgraphs-deploy.yml` deploys on a manual run. The key never goes on a command
line or into `~/.graph-cli.json`: `tools/deploy-studio.mjs` explains how.

Studio indexes a new version from the start block in `packages/core`. Check it by deployment
hash, not by name: the name can still answer from the previous version.

To check a deployed version against the chain, point the differential at its query URL:

```
SUBGRAPH_URL=<studio query URL> pnpm --filter @cobuilders/safenet-subgraph-mainnet differential
```
