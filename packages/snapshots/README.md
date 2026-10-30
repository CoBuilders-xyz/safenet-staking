# Daily snapshots of the Safenet validator dataset

Once a day, `.github/workflows/snapshots.yml` publishes an immutable snapshot of the full
validator dataset to IPFS: state, history and events, every figure read at one Mainnet block,
one Gnosis block and SEF's latest commits. A snapshot is a directory addressed by its CID, and
a date index maps each UTC day to that CID. An operator can audit the network state at a known
point in time without depending on any indexer, and a staker has a point-in-time reference.

## Where the snapshots are

| What | Where |
|---|---|
| The date index | `index.json` on the orphan branch [`snapshots`](https://github.com/CoBuilders-xyz/safenet-staking/tree/snapshots). `INDEX_CID` beside it is the CID the index is pinned under |
| One day | `/ipfs/<CID>/` on any IPFS gateway, with `<CID>` from the index |
| Each run | the workflow's job summary: the day's CID, the index CID, each gateway's answer and the verification output; and the run's artifact, kept 90 days |

The index is published outside `main` so the main history stays clean. Each version names the
CID of the version before it in `previous`, so the pinned versions form a chain any reader can
walk back with no access to the branch. A day already in the index is never replaced: a second
run on the same day pins nothing.

A pull request that changes this package or the workflow runs one real snapshot and writes the
branch `snapshots-preview` instead, where a day can be replaced. That branch is a test of the
pipeline, not a publication.

## Verify a snapshot

You need Node and pnpm, as in the root `README.md`. No account and no secret.

```sh
pnpm snapshot:verify <CID>                               # through the gateways in packages/core
pnpm snapshot:verify <CID> --gateway https://<gateway>   # through a gateway you choose
pnpm snapshot:verify <directory> --cid <CID>             # a copy you already have
pnpm snapshot:verify --index index.json --day 2026-10-27 # a day, from an index file
```

From a CID, the script fetches `manifest.json` and every file it lists by path, packs them here
and compares the result with the CID. The gateway is not trusted: one changed byte, or a left-out
file, gives another CID. An index CID verifies the same way.

Without this repository's code, pack a downloaded copy with the `ipfs-car` command line at the
version the release uses. It must print the same CID:

```sh
npx ipfs-car@3.1.0 pack <directory> --output /tmp/check.car
```

The settings are ipfs-car 3.1.0's defaults, the same as the interface's release: CIDv1, raw
leaves, 1 MiB fixed-size chunks, balanced layout 1024 links wide, no mtime and no mode.
`VERIFY.md` at the root has the same steps for the release.

## Build one yourself

```sh
pnpm snapshot:build      # writes packages/snapshots/out/<day>, git-ignored
```

It needs the archive `MAINNET_RPC_URL` from `pnpm env:pull`: the delegator counts and the
withdrawal totals scan logs from the staking contract's deploy block, which the public endpoints
refuse. Your snapshot has a later block than the published one, so it has another CID. What you
can compare is any figure at the same block: see "Cross-check a figure".

## The dataset

One directory per UTC day, the day of the Mainnet block:

| File | Holds |
|---|---|
| `manifest.json` | the blocks, the SEF commits, the files, the checks that passed, and the commit and run that built it |
| `network.json` | the network totals, the Mainnet subgraph's `Network` row and its daily `DayData` series |
| `validators.json` | per validator: stake, share, registration, delegators, SEF's label, commission, activity and participation rate, its subgraph record, its delegations and its stake and withdrawal events; and every staker |
| `withdrawals.json` | the pending total and count, each open withdrawal queue read from the contract, and every withdrawal |
| `rewards.json` | the allocation, the epoch, the unclaimed balance, the Merkle root on chain and published, where `latest.json` was read from, and every reward period, account and claim |
| `participation.json` | the Gnosis participation buckets, hourly and daily, per validator and network-wide, with the programme each belongs to |
| `sef/validator-info.json`, `sef/network-info.json`, `sef/rewards/latest.json` | SEF's files byte for byte, as published at the commit `manifest.json` names |

JSON is written with a two-space indent and a final newline. Amounts in wei are decimal
strings, because JSON numbers lose precision past 2^53. Dates are ISO 8601. Subgraph rows keep
the subgraph's own types: `BigInt` as a decimal string, `Int` as a number, a reference such as
`validator` as the referenced id.

### Every figure names where it was read

A figure is an object with `value`, `source` and `at`:

```json
{
  "value": "69560833162022313723058414",
  "source": "chain: Staking.totalStakedAmount()",
  "at": [{ "chain": "mainnet", "block": "26287194" }]
}
```

`source` is the CLI's own wording, the same string `safenet --json` prints. `at` lists every
point the figure was read at:

| `at` entry | Means |
|---|---|
| `{ "chain": "mainnet", "block": "<n>" }` | an `eth_call`, a log scan or a subgraph query at that block |
| `{ "chain": "gnosis", "block": "<n>" }` | a Gnosis subgraph query at that block |
| `{ "sef": "<file>", "commit": "<sha>" }` | one of SEF's files at that commit of `safe-fndn/safenet-data` |
| `{ "sef": "rewards/latest.json", "dataset": "<url>" }` | SEF's reward dataset behind its ENS name, when the name is set |

A figure from both, such as the registered count, which asks the chain about each address SEF
lists, names both. A figure that is null carries `reason`. Subgraph rows come as a collection
that names the point once: `source`, `at`, `deployment`, `absentFields` and `rows`.
`absentFields` lists the fields this repository's schema has and the deployed subgraph does not;
the deployment in `packages/core` can lag the schema on `main`.

### One instant

The figures the CLI's library computes come from it, not from a copy: `getStatus`,
`showValidator`, `networkWithdrawals` and `readQueue`. They read the head and SEF's `main` by
themselves, so the builder hands them a context pinned to the snapshot's points
(`src/pinned.ts`): the head is the pinned block, every contract read without a block is held at
it, a log scan past it is refused, and a read of SEF's `main` is a read at the pinned commit.
Each SEF file is fetched once, so the figures and the copy in `sef/` are the same bytes.

The Mainnet block sits a few confirmations below the lower of the RPC's head and the Mainnet
subgraph's head. Every subgraph query names the block by the hash the RPC gave, which fails when
the subgraph is on another fork. The Gnosis block is the Gnosis subgraph's head.

### The checks

Where the chain and the Mainnet subgraph describe the same quantity, they must agree to the wei
at the pinned block, or the day is not published: the staked total, the pending withdrawals and
the Merkle root; each validator's stake, and its current and ever delegator counts; the open
withdrawal logs and the sum of every open queue, against the pending total. `manifest.json`
lists each check with both values.

### A day is published whole or not at all

The build stops with one sentence, and writes nothing for the day, when a figure cannot be read:
an RPC or subgraph failure, a SEF file that lost a field the CLI reads, a delegator count the
log scan could not complete, an unknown participation window, a subgraph with indexing errors or
older than core's staleness threshold. It stops too when a check above fails. The files are
written to a hidden directory and renamed to the day only once they match the manifest, and the
publish step refuses a directory that does not.

### The programme caveat

The Gnosis buckets in `participation.json` come from the Gnosis subgraph in `packages/core`.
The current deployment indexes Aegis. `GNOSIS_INDEXED_PROGRAMME` in
`packages/core/src/sef.ts` supplies that programme when the schema lacks per-row attribution.
SEF's `participation_rate_14d` in `validators.json` describes the programme running when SEF
publishes. The snapshot preserves each source's programme and window; it does not assume
that a bucket collection and SEF's published rate cover the same ceremonies.

Each bucket collection carries its programme in `participation.json`'s `programme` object. When
the deployment's schema has no `programme` field, the value is `GNOSIS_INDEXED_PROGRAMME` and
the source says so. When the schema has a `programme` field on every bucket, each row carries
it as the subgraph answers. The collection-level value is then `null`, with the source
`subgraph: Gnosis <Type>.programme, on each row`.

### What is not in a snapshot

- SEF's per-address reward proofs. They are in SEF's reward dataset and repository, and each
  depends on one address; `rewards.json` holds the root they prove against.
- Validators' Gnosis signing keys beyond the `SigningValidator` rows.
- Anything from a block other than the two pinned ones.

## Cross-check a figure

The CLI prints the same figures with `--json`, at the head. To compare at a snapshot's block,
point it at an Anvil fork of Mainnet at that block:

```sh
anvil --fork-url "$MAINNET_RPC_URL" --fork-block-number <block> --port 8599
pnpm --filter @cobuilders/safenet-cli start status --json --rpc-url http://127.0.0.1:8599
```

`block` and `totalStaked` in the output must equal `manifest.json`'s Mainnet block and
`network.json`'s `totalStaked.value`.

## Scripts

| Script | What it does |
|---|---|
| `snapshot:build [--out <dir>]` | builds the day; needs `MAINNET_RPC_URL` |
| `snapshot:publish --dir <day> --out <dir> [--index <dir>] [--replace]` | packs, pins and checks the gateways for the day and the new index; needs `PINATA_JWT` and `PINATA_GATEWAY` |
| `snapshot:verify <directory \| CID>` | re-derives the CID from the files |

Run them from the root as `pnpm --filter @cobuilders/safenet-snapshots <script>`; `snapshot:build`
and `snapshot:verify` also run as `pnpm <script>`.
