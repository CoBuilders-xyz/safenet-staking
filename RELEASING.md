# Releasing

How each part of Safenet Staking reaches production. Worker setup and the Telegram webhook are in
[DEPLOY.md](DEPLOY.md), the rebuild of a web release in [VERIFY.md](VERIFY.md).

## What production is

| Part | Where users reach it | How it ships |
|---|---|---|
| Web interface | `safenet.cobuilders.eth.limo` (the ENS name) and the Vercel production domain, also the Safe App origin | A `web-v*` release: *Release* (`release.yml`) |
| `@cobuilders/safenet-cli`, `@cobuilders/safenet-mcp` | npm; the `safenet` binaries on GitHub Releases | A `cli-v*` or `mcp-v*` release: *Publish* (`publish.yml`), and *CLI binaries* for `cli-v*` |
| REST API, alerts | their `workers.dev` URLs | *Workers deploy* (`workers-deploy.yml`), by hand |
| Subgraphs | Subgraph Studio, then The Graph Network | *Deploy subgraphs to Studio* (`subgraphs-deploy.yml`), by hand |

`packages/core` and the other private packages are not released on their own. A change to them
ships with the parts that use them. The daily snapshot publishes data, not code.

## How a release works

1. **Draft.** Actions → *Create draft release* → *Run workflow* from `main`, with the project. It
   picks the next version and creates a draft GitHub Release for the head of `main`, with the
   commits that changed the project since its last release. `dry_run` prints the same and creates
   nothing.
2. **Publish.** Read the draft, edit its notes if needed, and choose *Publish release*. That
   creates the tag, and the tag starts the project's own workflow.

A draft ships nothing, and a draft no one publishes can be deleted.

### Versions and tags

- **cli, mcp:** the semver in `package.json`, tag `cli-v<version>` or `mcp-v<version>`. Raise the
  version in a pull request first: a version that already has a tag or a draft stops the draft.
  A version with a hyphen, such as `0.1.0-beta.3`, makes a draft marked *Pre-release*.
- **The other parts:** the date in Buenos Aires and a counter, tag `<project>-v<YYYYMMDD>.<N>`.
  `N` is 0 for the first release of the day, then one more than the highest earlier `N`: for
  example `web-v20261118.0`, then `web-v20261118.1`.

## Rules

1. **Production changes only through a release.** A merge to `main` changes nothing users see.
   In Vercel, *Settings → Environments → Production → Auto-assign Custom Production Domains*
   stays off, so a merge only builds a deployment without the domain.
2. **Main only.** A release builds a commit of `main`. A wrong release is fixed by the next one,
   never by moving a tag.
3. **A changed build input is a web release.** That is `apps/web/build.env` and the repository
   variables `VITE_VALIDATOR_INFO_URL` and `VITE_ALERTS_API_URL`. Vercel's own environment
   variables no longer reach production.
4. **Ship compatible, in either order.** The web must work with the Workers and subgraphs already
   deployed, and a Worker must keep working with the web release that is live: add first, remove
   later. A Worker change that keeps new personal data waits for the web release whose privacy
   policy describes it.

## Release the web

Publishing a `web-v*` draft runs *Release* on the tagged commit:

1. **build**: builds from `apps/web/build.env` and the repository variables, with no secret but
   the public Graph browser key, and packs the CAR. Anyone can rebuild its CID ([VERIFY.md](VERIFY.md)).
2. **approve**: the run waits in the `release-approval` environment until its reviewer approves.
   This is the only approval: nothing is pinned or published before it, and nothing after it
   asks again.
3. **pin**: pins the CAR to Pinata and checks that the public gateways serve it. The dedicated
   Pinata gateway in `PINATA_GATEWAY`, if set, is checked for information only.
4. **smoke**: the production smoke suite on the new CID, through Orbitor's gateway.
5. **publish**, in the `production` environment, which holds the credentials:
   1. uploads the files of the CAR to Vercel as a deployment without the production domain;
   2. sets the contenthash of `safenet.cobuilders.eth` to the CID, and reads it back;
   3. moves the Vercel production domain to that deployment, and checks that it serves the
      `index.html` of the build.

The ENS name and Vercel then serve the same files. A red step stops the run, and the steps before
it are safe to repeat: *Re-run failed jobs* finishes the release. When the Vercel upload fails,
production has not changed. When the ENS or the domain step fails, the two origins can differ
until the rerun.

After a release, add its CID to `deployments.json` in a pull request. The availability check
reads the latest entry to know which CID the gateways must serve.

A manual run of *Release* builds only. Use it to see the CID of a commit.

### Roll back the web

Release the previous good commit again: revert the change on `main`, then draft and publish a web
release. To act at once, set the ENS contenthash back to the previous CID (in `deployments.json`)
and promote the previous Vercel production deployment in Vercel's dashboard, both by hand.

### One-time setup

**Environments.** Two GitHub environments, under *Settings → Environments*:

| Environment | Required reviewer | Deployment branches and tags | Holds |
|---|---|---|---|
| `release-approval` | yes, the deployer | `main` and tags `*-v*` | nothing |
| `production` | no | `main` and tags `*-v*` | the credentials below and the Worker secrets |

The approval lives in `release-approval`, so each release and each Workers deploy asks once. The
`production` environment has no reviewer, so the job that reads the credentials does not ask
again. Only `main` and release tags reach it, so restrict who can create `*-v*` tags with a tag
ruleset.

The `publish` job reads these from the `production` environment or the repository. It stops, and
names what is missing, when one is empty.

| Name | Kind | What it is |
|---|---|---|
| `ENS_MANAGER_PRIVATE_KEY` | `production` secret | The key of the account that manages `safenet.cobuilders.eth` |
| `VERCEL_TOKEN` | `production` secret | A Vercel access token for the team that owns the project |
| `MAINNET_RPC_URL` | repository secret | Already set for the nightly jobs |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | variables | The team and project ids, from Vercel's project settings or `.vercel/project.json` after `vercel link` |
| `PRODUCTION_URL` | variable | Already set: the Vercel production domain |

**The ENS manager.** A dedicated account, used for nothing else:

1. Create a new account. Store its private key only as the `ENS_MANAGER_PRIVATE_KEY` secret.
2. From the Safe that owns `cobuilders.eth`, in the ENS app, set the manager of
   `safenet.cobuilders.eth` to the new address. Keep the name's resolver. The Safe stays the
   owner of `cobuilders.eth` and can take the subname back at any time.
3. Send the account a little ETH for gas. One contenthash change costs about 50,000 gas.

If the key leaks, the Safe sets another manager. The key can change only this name's records.

**Vercel.** Create the token in Vercel → *Account Settings → Tokens*, scoped to the team. Keep
*Auto-assign Custom Production Domains* off (rule 1).

The first release with this workflow also tests the Vercel upload: until then, it has not run
against this project. If it fails, the run stops before the ENS step.

## Publish the CLI and the MCP server

Publishing a `cli-v*` or `mcp-v*` draft runs *Publish*. It builds the package once, installs the
tarball outside the monorepo and tests it against Mainnet, then publishes that tarball with
`npm publish --provenance` through npm Trusted Publishing over GitHub OIDC. No npm token exists in
the repository. A `cli-v*` release also runs *CLI binaries*, which attaches the binaries and
`SHA256SUMS` to the release.

To check a package before a release, run *Publish* by hand with `publish` off. It packs, installs
and checks the tarball, and publishes nothing.

Prereleases publish under their first identifier, `0.1.0-beta.3` under `beta`. Stable versions
publish under `latest`. The workflow runs no `npm dist-tag` command.

**State on 2026-11-18:** both packages are at `0.1.0-beta.3`. On npm, `beta` is `0.1.0-beta.3` and
`latest` is `0.1.0-beta.1`, a prerelease. To take `latest` off a prerelease, from an npm session
on the home machine: `npm dist-tag rm @cobuilders/safenet-cli latest`, the same for `-mcp`. Never
remove `latest` from a stable version.

**Trusted Publisher**, on npmjs.com for each package, *Settings → Trusted Publisher*: organization
`CoBuilders-xyz`, repository `safenet-staking`, workflow `publish.yml`, no environment, npm publish
allowed, npm dist-tag not allowed. A publisher cannot be edited: delete it and create a new one,
then publish within two days, or it expires.

## Deploy the API, alerts or a subgraph

These still run by hand, from `main`, until each has its own release workflow:

- **API, alerts:** Actions → *Workers deploy*, then approve the `release-approval` environment.
  [DEPLOY.md](DEPLOY.md) lists the inputs. Afterwards, check the API with
  `API_URL=<origin> pnpm --filter @cobuilders/safenet-api smoke`.
- **Subgraphs:** Actions → *Deploy subgraphs to Studio*. The package's `CLAUDE.md` has the slug and
  the steps. Query the label that `packages/core` pins right after the deploy: a new Studio version
  can archive the previous one, and shipped builds keep calling the label they pin.

## Checks

| Check | Where | What it proves |
|---|---|---|
| Availability | `availability.yml`, every six hours and on demand | Vercel answers with the title and its entry script; each gateway serves the latest CID in `deployments.json` |
| Release smoke | `release.yml`, on the new CID | What a visitor without a wallet sees, before the ENS name or Vercel moves |
| Production smoke | `nightly.yml` | The same suite on the Vercel production domain |

A failed scheduled check opens an issue labelled `ci-red`, or comments on the open one. Close it
when the cause is fixed.
