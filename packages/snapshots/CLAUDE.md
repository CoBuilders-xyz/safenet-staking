# packages/snapshots

The daily snapshot of the Safenet validator dataset, and the IPFS path the interface's release
shares with it. `README.md` has the dataset schema, the programme caveat, how to verify a
snapshot and where the index lives. Read it before changing a file's shape.

## Why it is a package

It needs TypeScript, the CLI's library and core, and the IPFS libraries, with the five verbs and
Turborepo's fan-out. `tools/` holds plain scripts with no dependencies of their own.

## Files

- `src/ipfs/`: packing a directory into a CAR, pinning it to Pinata and proving the gateways serve
  it. Exported as `@cobuilders/safenet-snapshots/ipfs`; `apps/web/scripts/release.ts` and
  `release-pin.ts` use it. A change to `car.ts` changes the release CID too: rebuild the release
  before and after, and compare.
- `src/points.ts`: the Mainnet block, the Gnosis block and SEF's commits a snapshot describes.
- `src/pinned.ts`: the CLI context held at those points. A read it does not pin throws.
- `src/subgraph.ts`: whole entities at one block, by hash, with the fields the deployment has.
- `src/dataset.ts`: every figure, the checks, and the day's files.
- `src/write.ts`: the day written whole or not at all.
- `src/date-index.ts`: the date index and its update rule.
- `src/verify.ts`: re-deriving a CID from files, local or fetched by path.
- `src/bin/`: the three scripts.
- `src/test-support.ts`, `src/fixtures/`: the fakes and the fixtures. The fixtures are cut from a
  real snapshot, with every address and hash replaced by a made-up value. Keep it so: no real
  address outside `packages/core`.

## Rules

- A figure the CLI's library computes comes from it. Add to the library, not here.
- Every figure names its block or its SEF commit, through `at`. A figure whose source names
  neither the chain nor a SEF file throws.
- A figure that cannot be read, or two sources that disagree at the same block, stop the day.
  Never write a partial day, and never publish one.
- Subgraphs are read from the defaults in `packages/core`, with no override, because their URLs
  go into the public manifest.

## Tests

`pnpm test` runs `src/**/*.test.ts` with node:test, offline. `src/dataset.test.ts` runs the
builder over the fixtures, including the days that must abort.
