# Verify a release

Production for this interface is a directory on IPFS. Its address, the CID, is a hash of the
exact files. Anyone can rebuild those files from this repository and get the same CID. If the
CID you build matches the CID being served, the interface you load is the source you read.

## What you need

- Git.
- Node **22.23.4**, pinned in `.nvmrc` and used by the release workflow. For an older release,
  use the `.nvmrc` from that release's tag or commit. The current minimum is Node 22.18.0.
- pnpm **10.28.2**, the version in the `packageManager` field of `package.json`.
  `corepack enable` selects it for you.

Nothing else. No account, no secret, no network access after the install.

## Rebuild and compare

```sh
git clone https://github.com/CoBuilders-xyz/safenet-staking.git
cd safenet-staking
git checkout <release tag or commit>
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @cobuilders/safenet-web release:build
cat apps/web/release/CID
```

Compare that CID with the published one:

- the `Release CID` in the summary of the release workflow run for that tag, also in the
  `CID` file of its `release-<CID>` artifact;
- the CID a gateway serves: request `/ipfs/<CID>/index.html` from any public gateway in
  `IPFS_GATEWAYS`, in `packages/core/src/rewards-source.ts`. The release workflow checks those
  same gateways.

To rebuild a second time, start clean: `rm -rf apps/web/dist apps/web/release`. The release
build also does this itself.

## Check the CID without our packing script

`release:build` packs `apps/web/dist` with the `ipfs-car` library. The `ipfs-car` command line
tool, at the same version, packs the same directory into the same bytes:

```sh
npx ipfs-car@3.1.0 pack apps/web/dist --output /tmp/check.car
```

It prints the root CID. It must equal `apps/web/release/CID`.

## What goes into the CID

| Input | Where |
|---|---|
| The source at the commit | `apps/web`, `packages/core` |
| Every dependency, at an exact version | `pnpm-lock.yaml` |
| The public build-time values | `apps/web/build.env` |
| The CID settings | `ipfs-car` 3.1.0 defaults: CIDv1, raw leaves, 1 MiB fixed-size chunks, balanced layout 1024 links wide, no mtime, no mode |

Nothing else. The release build ignores every `.env` file, every `VITE_` variable in your
shell and the graph-node port in `.env.ports`, and the bundle holds no timestamp. Text files
are checked out with LF line endings on every platform, by `.gitattributes`. `apps/web/build.env` is committed and holds only
public values; a value there ships to every visitor.

## If your CID differs

1. `git status` must be clean, and `git rev-parse HEAD` must be the released commit.
2. `node --version` must match the checked-out `.nvmrc` (`v22.23.4` currently), and `pnpm --version` must print `10.28.2`.
   The release build forces `NODE_ENV=production`. If you changed the script, check that
   your shell's `NODE_ENV` does not reach Vite: `NODE_ENV=development` gives another CID.
3. `pnpm install` must have run with `--frozen-lockfile`, so the lockfile did not change.
4. `git ls-files --eol apps/web | grep crlf` must print nothing. `.gitattributes` checks text
   out with LF, but a working tree written before it existed can still hold CRLF in
   `index.html` or under `public/`, and that gives another CID. Re-clone to fix it.
5. The release build sets `GRAPH_NODE_PORT` to an empty string. `vite.config.ts` inlines that
   port into the bundle, from your shell or from the `.env.ports` that `pnpm bootstrap` writes
   per worktree. If you changed the script, check that neither reaches Vite.
6. Compare the files: `ls -lR apps/web/dist` on both sides, then `diff` the first file that
   differs. A difference there is a reproducibility bug. Please open an issue with it.

## Verify a daily snapshot

The daily snapshots of the validator dataset are packed with the same settings. Their CIDs are in
`index.json` on the branch `snapshots`. To re-derive one from its files through any gateway:

```sh
pnpm snapshot:verify <CID>
```

Or download the directory, then pack it with the `ipfs-car` command line, which must print the
same CID: `npx ipfs-car@3.1.0 pack <directory> --output /tmp/check.car`.
[`packages/snapshots/README.md`](packages/snapshots/README.md) has the details.
