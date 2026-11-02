# Graph Network gateway (COB-566)

Core `subgraphEndpoints()` resolves each chain independently:

1. A nonempty full URL override.
2. The Network gateway using the caller's nonblank API key.
3. Studio account **1763864**, version **e66567d**, without a key.

| Chain | Network subgraph ID |
|---|---|
| Mainnet | `K1gHS5P5vZU3LApqchuuQxkmZGDDAUavkQUdGDV7Vxs` |
| Gnosis | `9ZnBWftc6QB4tLn2CeYKTCqZkUrwjUNtH4DXvXHahG8q` |

Core never reads environment variables. Web passes `VITE_GRAPH_API_KEY` and
`VITE_SUBGRAPH_URL_MAINNET` / `VITE_SUBGRAPH_URL_GNOSIS` to the shared resolver.
CLI/MCP pass runtime `GRAPH_API_KEY` and `SUBGRAPH_URL_MAINNET` for reward history.
Parity scripts accept `GRAPH_API_KEY` and both `SUBGRAPH_URL_*` overrides.
Web and CLI/MCP retry failed queries to our Network IDs once against matching Studio.
This includes HTTP auth/billing/rate-limit/5xx errors, GraphQL errors at HTTP200,
timeouts and network failures. A warning appears once per chain per browser session
or CLI/MCP process (console/stderr), without keys or provider error text.
If Studio also fails, existing unavailable/error states apply. Cancellation never retries.
Custom non-gateway URL overrides retain their own error behavior. Full URLs to our
Network IDs also receive Studio fallback. Single-query retries preserve the query and block selector. CLI/MCP period reads retry
the complete metadata-and-period operation, using Studio’s own indexed block after fallback.
The parity scripts deliberately query the chosen endpoint directly so gateway failures remain visible.

## Operator settings (values are not set by this PR)

1. In The Graph Studio API-key settings, use **Assign Subgraphs** to restrict the key
   to the two IDs above. Set **USD 20/month** as the spending limit.
   Set **no domain allowlist**: any IPFS gateway, Vercel or tailnet origin may query.
   The browser key is public and permanent in an IPFS release. The current account has
   0 GRT billing balance; fund it before expecting paid gateway queries to succeed.
   Authentication/billing errors use the automatic Studio fallback meanwhile.
2. GitHub repository Settings → Secrets and variables → Actions: set secret
   **GRAPH_API_KEY**. Only the Release build step maps it to **VITE_GRAPH_API_KEY**.
   No deploy credential, private RPC token or other secret belongs in this variable.
   PR CI uses no real key; do not expose credentials to pull-request code.
3. Vercel project Settings → Environment Variables: set **VITE_GRAPH_API_KEY**
   for **Preview** (and **Development** only if desired). The existing web build
   reads it through Vite; Turbo hashes it so a key change invalidates the build cache.
   Remove retired **VITE_SUBGRAPH_URL_MAINNET** and **VITE_SUBGRAPH_URL_GNOSIS**
   overrides unless they are intentional. Full overrides always take priority.
   No Vercel API key or new GitHub secret is needed for this wiring.
4. CLI/MCP launch environment: optionally set **GRAPH_API_KEY** from your secret manager.
   CLI/MCP requests do not send a browser Origin; no domain allowlist is configured.
   Without a key, the updated Studio fallback works within Studio limits.
5. Release reproducibility requires the same public browser key as the original build.
   `release:build` accepts only `VITE_GRAPH_API_KEY` in addition to committed `build.env`.
   It ignores other shell VITE values and all .env files. See [VERIFY.md](VERIFY.md).

The internal preview origin `<internal-preview-host>` needs no special
allowlist entry. Billing/auth failures still fall back to Studio. Do not change the key policy automatically.

For local tests, use a synthetic key. For live gateway verification, load the real key
into a short-lived process environment and redact request URLs and provider errors.
Never commit a key or log a keyed endpoint. A gateway-enabled production bundle will
contain the public key by design; a no-key or synthetic-key QA bundle must not contain it.
