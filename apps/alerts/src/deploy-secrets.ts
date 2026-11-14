import { mainnetSubgraphUrl } from "./sources.js"

/** Values the deploy workflow must supply. cloudflare.config.ts declares each one as a secret. */
export const REQUIRED_DEPLOY_SECRETS = ["APP_ORIGINS", "MAINNET_RPC_URL", "GNOSIS_RPC_URL", "GRAPH_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_NAME", "TELEGRAM_WEBHOOK_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const

/**
 * The secrets uploaded with a new alerts version. SUBGRAPH_URL_MAINNET is always included: the
 * override when one is set, else the gateway URL derived from GRAPH_API_KEY. `cf` keeps a secret
 * that an upload omits, so omitting it would leave a removed override deployed.
 * Throws with the names of missing values, never their contents.
 */
export function deploySecrets(env: Record<string, string | undefined>): Record<string, string> {
  const missing = REQUIRED_DEPLOY_SECRETS.filter(name => !env[name])
  if (missing.length) throw new Error(`Missing production values: ${missing.join(", ")}`)
  const out: Record<string, string> = Object.fromEntries(REQUIRED_DEPLOY_SECRETS.map(name => [name, env[name]!]))
  out.SUBGRAPH_URL_MAINNET = mainnetSubgraphUrl({ GRAPH_API_KEY: out.GRAPH_API_KEY!,
    ...(env.SUBGRAPH_URL_MAINNET ? { SUBGRAPH_URL_MAINNET: env.SUBGRAPH_URL_MAINNET } : {}) })
  return out
}
