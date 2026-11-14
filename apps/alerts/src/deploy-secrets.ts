import { mainnetSubgraphUrl } from "./sources.js"
import { usableWebhookSecret, webhookUrlFor } from "./telegram.js"

/** Values the deploy workflow must supply. cloudflare.config.ts declares each one as a secret. */
export const REQUIRED_DEPLOY_SECRETS = ["APP_ORIGINS", "MAINNET_RPC_URL", "GNOSIS_RPC_URL", "GRAPH_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_NAME", "TELEGRAM_WEBHOOK_SECRET", "ALERTS_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const

/**
 * The secrets uploaded with a new alerts version. SUBGRAPH_URL_MAINNET is always included: the
 * override when one is set, else the gateway URL derived from GRAPH_API_KEY. `cf` keeps a secret
 * that an upload omits, so omitting it would leave a removed override deployed.
 * Throws with the names of missing values, never their contents. Also throws for a webhook secret
 * or a Worker origin the Worker would not use: deployed, either one would stop every Telegram link
 * while the deploy itself looked green.
 */
export function deploySecrets(env: Record<string, string | undefined>): Record<string, string> {
  const missing = REQUIRED_DEPLOY_SECRETS.filter(name => !env[name])
  if (missing.length) throw new Error(`Missing production values: ${missing.join(", ")}`)
  if (!usableWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 32 to 256 characters of A-Z, a-z, 0-9, _ and -")
  if (!webhookUrlFor(env.ALERTS_URL)) throw new Error("ALERTS_URL must be the alerts Worker's https origin: no path, query or credentials")
  const out: Record<string, string> = Object.fromEntries(REQUIRED_DEPLOY_SECRETS.map(name => [name, env[name]!]))
  out.SUBGRAPH_URL_MAINNET = mainnetSubgraphUrl({ GRAPH_API_KEY: out.GRAPH_API_KEY!,
    ...(env.SUBGRAPH_URL_MAINNET ? { SUBGRAPH_URL_MAINNET: env.SUBGRAPH_URL_MAINNET } : {}) })
  return out
}
