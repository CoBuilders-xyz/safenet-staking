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

## Parity with SEF

```
SUBGRAPH_URL_MAINNET=<studio query URL> pnpm --filter @cobuilders/safenet-subgraph-mainnet test:parity
```

`scripts/parity.ts` compares the staked total with `total_staked_amount` in SEF's
`network-info.json`, to the wei, at the commit that last wrote the file. SEF's job reads the
chain and then commits, so the comparison takes the block before the commit first, and an earlier
block of that hour only when SEF's figure equals the total there exactly.

It does not query the total `block: { number }` back in time: Studio keeps about 1,000 blocks of
history, a few hours on Mainnet. It rewinds the current total through the Stake and Withdrawal
rows after the start of SEF's run instead, which this subgraph keeps for good. Without
`SUBGRAPH_URL_MAINNET` it reads the local graph-node. `.github/workflows/parity.yml` runs it
daily; the root `CLAUDE.md` gives the stale rule.

