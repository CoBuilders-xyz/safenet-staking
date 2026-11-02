# npm beta releases and Trusted Publishing

The first release of `@cobuilders/safenet-cli` and `@cobuilders/safenet-mcp`
is **0.1.0-beta.0**. The intended channel is **beta**, with no prerelease under `latest`.
npm initially violates this policy for a new package; the bootstrap cleanup below is mandatory.
This document is an operator checklist, not authorization to publish.

The Publish workflow builds each package once, installs the tarball outside the
monorepo, tests it, and publishes that same tarball. Stable versions use `latest`.
Prereleases use their first semver identifier, ignoring build metadata:
`0.1.0-beta.0` → `beta`; `1.0.0-alpha.1` → `alpha`; `1.0.0-rc.1+build` → `rc`.
Use named prerelease channels accepted by npm; npm rejects numeric/semver-range dist-tags.

## Prerequisites and credential-free QA

1. Review and merge the release PR only when Augusto approves it.
2. Use the pinned Node version in `.nvmrc` (22.23.4) and npm **12.2.1**.
   Trusted Publishing requires npm >=11.5.1 and Node >=22.14.0.
3. Make the repository public before a publishing run: npm provenance requires
   a public source repository. Private-repository dry runs remain available.
4. In GitHub Actions → **Publish** → **Run workflow**, select the branch and
   package `cli`; keep **publish=false**. Repeat for `mcp`.
   This is also supported before merge. It packs, installs and checks the tarball;
   it does not publish. No npm credential is needed. `MAINNET_RPC_URL` is optional
   for installed-package checks; public RPC endpoints are the default.
5. Inspect the two `tarball-cli` / `tarball-mcp` artifacts and their SHA-256 summaries.
   Each manifest must say `0.1.0-beta.0`. Do not trigger publishing tags yet.

## One-time bootstrap: package must already exist

npm cannot configure a Trusted Publisher for a package that does not exist.
OIDC alone cannot create the first package. See [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
and [npm/cli#8544](https://github.com/npm/cli/issues/8544).
Check each package independently; one may exist while the other does not.
Augusto must have publish rights in the `@cobuilders` npm organization.

Choose **one** bootstrap option for missing packages. Both options require the tag cleanup below.

**First-publish quirk:** npm also assigns `latest` to a brand-new package's first version,
even with `--tag beta`. Until cleanup, untagged installs can receive the prerelease.
Our policy is to remove this accidental tag, not publish a placeholder or dummy stable version.
Treat publication and cleanup as one operator session. Do not announce the release until both packages' tags are verified.
This is not atomic: it cannot prevent installs during the short publication-to-cleanup window.

### A. Interactive first beta (recommended)

On Augusto's home machine, sign in to npm with his account and complete 2FA.
Download the exact checked tarballs from the publish=false run. Publish each once:

```sh
npm publish ./cobuilders-safenet-cli-0.1.0-beta.0.tgz --access public --tag beta
npm publish ./cobuilders-safenet-mcp-0.1.0-beta.0.tgz --access public --tag beta
```

Complete npm's interactive/browser approval. Never paste an OTP or token in chat.
After each successful publish, immediately complete the post-bootstrap tag cleanup below.
This interactive bootstrap cannot claim GitHub Actions provenance. Later OIDC
publishes from the public GitHub repository receive provenance automatically.

**This step already releases beta.0.** npm versions are immutable. Do not run
publish=true or push `cli-v0.1.0-beta.0` / `mcp-v0.1.0-beta.0` afterward:
those triggers would attempt to publish the same version again. Finish a reviewed version bump
such as `0.1.0-beta.1` and its dry-run checks before configuring trust for the first OIDC run.
Do not publish a dummy stable version just to reserve a package name.

### B. Temporary granular token for the first CI publish only (time-limited)

npm [targets January 2027](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)
for removing direct publishing with granular access tokens. Check the current npm policy before choosing this option.
Once that removal takes effect, option B is unavailable: use interactive option A instead.
This checklist does not introduce a staged-publishing workflow.

If Augusto chooses CI for bootstrap while supported, create a narrowly scoped, short-lived granular
npm publish token with the required organization/package permissions. Under npm's default publishing policy,
non-interactive token publishing requires **Bypass two-factor authentication** on that temporary token;
otherwise npm can request an OTP that CI cannot provide. This bypass authorizes publishing without interactive 2FA.
If the package disallows token publishing, this bootstrap option cannot work. Use interactive option A;
do not weaken the package policy to enable it. A new package may require organization-wide creation permission before it exists.
Temporarily configure a reviewed bootstrap-only workflow change that supplies it
as `NODE_AUTH_TOKEN` from GitHub Actions secret `NPM_TOKEN` and sets the npm registry
configuration for token auth. The normal workflow in this PR deliberately has no
such token path. Run the first beta once per missing package, using the validated
beta tags below or a publishing dispatch from main.

After bootstrap, complete tag cleanup, remove that temporary workflow auth,
delete the GitHub secret, and revoke the token in npm. Do not leave token auth as
an automatic fallback. This also consumes beta.0; subsequent releases need new versions.
Prepare the version bump and dry-run checks before configuring trust, as below.

## Post-bootstrap tag cleanup (both options)

Inspect each newly created package immediately after its first publish:

```sh
npm dist-tag ls @cobuilders/safenet-cli
npm dist-tag ls @cobuilders/safenet-mcp
```

For each package, confirm `beta` points to `0.1.0-beta.0`.
Run its removal command **only if `latest` also points to that bootstrap prerelease**:

```sh
npm dist-tag rm @cobuilders/safenet-cli latest
npm dist-tag rm @cobuilders/safenet-mcp latest
```

If `latest` is already absent, skip that package's removal. If it points elsewhere, stop and inspect;
never remove an existing stable release's tag. These commands remove tags, not package versions.
Repeat `npm dist-tag ls` for both packages. Required state: `beta: 0.1.0-beta.0`, no `latest` for these new beta-only packages.
Use explicit `@beta` installation commands. Check this state again after subsequent beta releases.

## Prepare the first OIDC release before configuring trust

1. Finish and merge the reviewed post-bootstrap version bump (for example, `0.1.0-beta.1`).
2. Complete CI and both `publish=false` runs for the exact release commit. Confirm the new versions are unpublished.
3. Only when ready to publish, configure each Trusted Publisher using the settings below.
4. Complete the first successful OIDC publish for each package within **two days** of configuring its publisher.

According to [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/), an unused configuration
expires if its first successful publish does not happen within two days. Do not start this clock during PR review.
If it expires, open that package's Settings → Trusted Publisher on npmjs.com, delete the expired configuration,
and recreate it with the same fields below. Then complete the first successful OIDC publish within the new two-day window.
Before retrying, check whether the version was published despite an interrupted run; never attempt to overwrite an existing version.

## Configure npmjs.com (each package separately)

In each package's **Settings → Trusted Publisher**, select **GitHub Actions**:

| Field | Value |
|---|---|
| GitHub organization/user | `CoBuilders-xyz` |
| GitHub repository | `safenet-staking` |
| Workflow filename | `publish.yml` (not its `.github/workflows/` path) |
| Environment | Leave unset: the publish job does not select a GitHub environment |
| Allowed actions | Enable direct `npm publish`; leave `npm dist-tag` disabled. `npm stage publish` is always allowed by npm |

Save for both `@cobuilders/safenet-cli` and `@cobuilders/safenet-mcp`.
`npm publish --tag beta` uses publishing permission, not separate `npm dist-tag` permission.
The workflow runs no `npm dist-tag` commands. Grant that separate permission only if a future reviewed workflow adds them.
Bootstrap tag cleanup above uses Augusto's authenticated operator session, not this OIDC publisher.
This is the **GitHub** organization identity; the npm organization is `@cobuilders`.
After validating OIDC, use npm's token restrictions to disallow token publishing
where available. No permanent `NPM_TOKEN` or `NODE_AUTH_TOKEN` belongs in GitHub.
The publish job grants `contents: read` and `id-token: write`; npm performs the OIDC exchange.
It uses `npm publish --access public --provenance --tag <channel>`, not pnpm's auth path.

## Publishing a version that does not already exist

After trust is configured, confirm the package version is unpublished and the
publish=false checks passed on that exact commit. For this PR's beta versions,
the tag names are **cli-v0.1.0-beta.0** and **mcp-v0.1.0-beta.0**.
Use them only if those versions were not already consumed by bootstrap.
A tag's version must exactly equal the respective package.json version.

Augusto can push one package tag at a time after approval, or choose Publish →
Run workflow → main → package → publish=true. Never use both for the same version.
The `cli-v*` tag also triggers standalone-binary release attachment. Review that effect.
For a post-bootstrap beta.1 release, bump versions in a new PR and use
`cli-v0.1.0-beta.1` / `mcp-v0.1.0-beta.1` instead.

Verify npm displays the expected version under `beta`, package contents, and OIDC
provenance for the CI-published release. Install with:

```sh
npm install --global @cobuilders/safenet-cli@beta
npx @cobuilders/safenet-mcp@beta
```

Do not promote `beta` to `latest` until Augusto approves a stable release.
