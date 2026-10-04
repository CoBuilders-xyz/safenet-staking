# safenet-staking

## Setup

Use the Node version in `.nvmrc` and pnpm.

```sh
pnpm bootstrap       # prepares this worktree: tools, dependencies, browser, secrets
pnpm link:services   # links this worktree to the Vercel project
pnpm env:pull        # pulls the development secrets into .env.local
```

`pnpm bootstrap` runs the last two by itself when the Vercel CLI is signed in. Otherwise,
run `vercel login`, then run them.

Secrets never live in the repository. They come from Vercel into `.env.local` at the
repository root, which git ignores.

## Commands

Every package implements the same five. Turborepo fans them out.

| Command | What it does |
|---|---|
| `pnpm bootstrap` | Prepares everything. Safe to re-run. |
| `pnpm dev` | Starts the local stack. |
| `pnpm build` | Builds all packages. |
| `pnpm test` | Unit tests. |
| `pnpm check` | Lint and types. |
