# npm beta releases and Trusted Publishing

The in-repo version of `@cobuilders/safenet-cli` and `@cobuilders/safenet-mcp` is **0.1.0-beta.1**.
This is the first OIDC publish candidate after Augusto manually published **0.1.0-beta.0** for both packages.
Both packages currently have `beta` and `latest` at `0.1.0-beta.0`; `0.0.0-stage` also exists.
Both Trusted Publishers are configured. Their unused configurations expire within two days unless each completes a successful OIDC publish.
This document is an operator checklist, not authorization to publish.

The intended prerelease channel is **beta**. Publishing beta.1 with `--tag beta` moves `beta` to `0.1.0-beta.1`.
It leaves `latest` at `0.1.0-beta.0` until Augusto removes it from his authenticated session.
The workflow must not run `npm dist-tag`: that Trusted Publisher permission is disabled.

The Publish workflow builds each package once, installs the tarball outside the monorepo, and tests it.
It publishes that same tarball. Stable versions use `latest`.
Prereleases use their first semver identifier, ignoring build metadata:
`0.1.0-beta.1` → `beta`; `1.0.0-alpha.1` → `alpha`; `1.0.0-rc.1+build` → `rc`.
Use named prerelease channels accepted by npm; npm rejects numeric/semver-range dist-tags.

## Prerequisites and credential-free QA

1. Review and merge the release PR only when Augusto approves it.
2. Use the pinned Node version in `.nvmrc` (22.23.4) and npm **12.2.1**.
   Trusted Publishing requires npm >=11.5.1 and Node >=22.14.0.
3. Use a public repository for publishing: npm provenance requires a public source repository.
   Private-repository dry runs remain available.
4. In GitHub Actions → **Publish** → **Run workflow**, select the branch and package `cli`; keep **publish=false**.
   Repeat for `mcp`. This is also supported before merge.
   It packs, installs and checks the tarball; it does not publish. No npm credential is needed.
   `MAINNET_RPC_URL` is optional for installed-package checks; public RPC endpoints are the default.
5. Inspect the two `tarball-cli` / `tarball-mcp` artifacts and their SHA-256 summaries.
   Each manifest must say `0.1.0-beta.1`. Do not trigger publishing tags yet.

## Completed manual bootstrap

Augusto already published `0.1.0-beta.0` of both packages by hand. Do not repeat the bootstrap.
npm cannot configure a Trusted Publisher for a package that does not exist; OIDC alone cannot create the first package.
See [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and [npm/cli#8544](https://github.com/npm/cli/issues/8544).

The manual bootstrap does not carry GitHub Actions provenance. The next OIDC releases will carry provenance.
npm versions are immutable. Do not push `cli-v0.1.0-beta.0` / `mcp-v0.1.0-beta.0` or dispatch publishing from the beta.0 commit.
Those triggers would attempt to publish an existing version again.
The reviewed beta.1 bump and its dry-run checks prepare the first OIDC release.

## Pending manual cleanup of latest

npm assigned `latest` to the bootstrap prerelease. Untagged installs receive beta.0 until Augusto removes that tag.
This cleanup uses Augusto's authenticated operator session on his home machine.
It is separate from the OIDC workflow and can happen before or after the beta.1 publish.
Do not enable `npm dist-tag` permission on the Trusted Publisher for this cleanup.

Inspect each package:

```sh
npm dist-tag ls @cobuilders/safenet-cli
npm dist-tag ls @cobuilders/safenet-mcp
```

Expect `beta` at `0.1.0-beta.0` before the OIDC release, or `0.1.0-beta.1` after that package's successful release.
Run each removal command **only if `latest` still points to `0.1.0-beta.0`**:

```sh
npm dist-tag rm @cobuilders/safenet-cli latest
npm dist-tag rm @cobuilders/safenet-mcp latest
```

If `latest` is already absent, skip that package's removal. If it points elsewhere, stop and inspect.
Never remove an existing stable release's tag. These commands remove tags, not package versions.
Repeat `npm dist-tag ls` for both packages. After cleanup, expect no `latest`; `beta` must retain its published version.
Use explicit `@beta` installation commands. Check this state again after subsequent beta releases.

## Prepare the first OIDC release

1. Finish and merge the reviewed `0.1.0-beta.1` version bump when Augusto approves.
2. Complete CI and both `publish=false` runs for the exact release commit. Confirm beta.1 remains unpublished for each package.
3. Check that both existing Trusted Publisher configurations remain valid, using the settings below.
4. Complete the first successful OIDC publish for each package within **two days** of configuring its publisher.

According to [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/), an unused configuration expires without a successful publish within two days.
Both configurations already exist, so their expiration clocks have started.
If one expires, open that package's Settings → Trusted Publisher on npmjs.com and delete the expired configuration.
Recreate it with the same fields below. Complete the first successful OIDC publish within the new two-day window.
Before retrying, check whether the version was published despite an interrupted run; never attempt to overwrite an existing version.

## Existing npmjs.com configuration (each package)

Both packages use **GitHub Actions** in **Settings → Trusted Publisher**:

| Field | Value |
|---|---|
| GitHub organization/user | `CoBuilders-xyz` |
| GitHub repository | `safenet-staking` |
| Workflow filename | `publish.yml` (not its `.github/workflows/` path) |
| Environment | Unset: the publish job does not select a GitHub environment |
| Allow npm publish | ON |
| Allow npm dist-tag | OFF |

`npm publish --tag beta` uses publishing permission, not separate `npm dist-tag` permission.
The workflow runs no `npm dist-tag` commands. Keep that permission disabled.
This is the **GitHub** organization identity; the npm organization is `@cobuilders`.
No permanent `NPM_TOKEN` or `NODE_AUTH_TOKEN` belongs in the workflow.
The publish job grants `contents: read` and `id-token: write`; npm performs the OIDC exchange.
It pins `npm@12.2.1` and runs `npm publish "$tarball" --provenance --access public --tag "$dist_tag"`.

## Publish beta.1 once per package

Confirm the package version remains unpublished and the `publish=false` checks passed on that exact commit.
The release tags are **cli-v0.1.0-beta.1** and **mcp-v0.1.0-beta.1**.
A tag's version must exactly equal the respective package.json version.

After approval, Augusto can push one package tag at a time, or select Publish → Run workflow → main → package → publish=true.
**Never use both a tag push and publish=true for the same package version.**
The `cli-v*` tag also triggers standalone-binary release attachment. Review that effect.

Verify npm displays `0.1.0-beta.1` under `beta`, the expected package contents, and OIDC provenance for each release.
Expect `latest` to remain at beta.0 unless Augusto completed the manual cleanup above.
Install with:

```sh
npm install --global @cobuilders/safenet-cli@beta
npx @cobuilders/safenet-mcp@beta
```

Do not promote `beta` to `latest` until Augusto approves a stable release.
