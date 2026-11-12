# apps/api

Read the root `CLAUDE.md`. Keep addresses, ABIs, programme dates and upstream URLs in core.

Use `cf`, with `cloudflare.config.ts`; do not create Wrangler configuration.
Run scripts from the root with `pnpm --filter @cobuilders/safenet-api`.

- `dev`: isolated loopback Worker. `API_PORT` defaults to 8797. Never reuse the manual QA fork.
- `build`: generated runtime/binding types, TypeScript and the deployable Worker bundle.
- `check`: generated types, lint and TypeScript. Root `pnpm check` includes this package.
- `test`: deterministic API contract and failure tests. Fixtures do not prove live deployment.
- `smoke`: real HTTP against `API_URL`, without mocks.
- `load`: real HTTP latency samples against `API_URL`, including failures and cache status.
- `test:reference`: Chromium against `REFERENCE_URL`, expecting real requests to `API_URL`.

Run `pnpm check` before every commit. Regenerate `.cloudflare/types` through `cf workers types`;
never write binding types by hand. `.cloudflare` output is ignored and rebuilt in CI.

One exception: an optional secret. `cf` requires every secret that `cloudflare.config.ts` declares
(`bindings.secret()` takes no options), so an optional one cannot be declared. Type it next to the
generated `Env`, as `src/index.ts` does for `GITHUB_TOKEN`, with a comment that says why. Declare
every required binding in the config.

Keep the validator list a bare array with SEF's snake_case names and fractional rates.
The reference's hook converts that array to `ValidatorInfo[]`. Labels come only from
forward-confirmed ENS. Missing ENS means an empty label, never SEF's manually edited label.
Missing participation means null. SEF activity does not mean on-chain registration.

Reject stale, malformed or indexing-error results. Never relabel Beta rows as Aegis.
Keep all pagination pinned to one indexed block hash. Never truncate complete history silently.
Do not log upstream URLs or exceptions: endpoint URLs can contain credentials.

Publication requires parent approval. A build, local workerd run or mocked test is not deployment evidence.
