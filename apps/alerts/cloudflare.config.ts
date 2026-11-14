import { bindings, defineConfig, triggers } from "cf/config"

// The D1 database created once with `cf d1 create` (DEPLOY.md). The deploy workflow passes its ID, so
// `cf deploy` binds that database and never provisions another one. Without the ID, as in local
// development and tests, the binding names a local database.
const databaseId = process.env.ALERTS_D1_DATABASE_ID || undefined

export default defineConfig({
  worker: {
    name: "safenet-alerts",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-29",
    compatibilityFlags: ["nodejs_compat"],
    // Served at safenet-alerts.<account subdomain>.workers.dev. No custom domain for now.
    workersDev: true,
    previewUrls: false,
    // Provider URLs can contain bot tokens. Keep tracing enabled but sample no URL spans.
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: false }, traces: { enabled: true, headSamplingRate: 0 } },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
    env: {
      DB: bindings.d1({ name: "safenet-alerts", ...(databaseId ? { id: databaseId } : {}) }),
      // Every declared secret is required at deploy. The optional APP_ORIGIN, REWARDS_BASE_URL and
      // SUBGRAPH_URL_MAINNET are therefore not declared here; src/types.ts types them.
      APP_ORIGINS: bindings.secret(),
      MAINNET_RPC_URL: bindings.secret(), GNOSIS_RPC_URL: bindings.secret(), GRAPH_API_KEY: bindings.secret(),
      TELEGRAM_BOT_TOKEN: bindings.secret(), TELEGRAM_BOT_NAME: bindings.secret(),
      // What Telegram sends with each update to POST /telegram/webhook, as given to setWebhook.
      TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
      VAPID_PUBLIC_KEY: bindings.secret(), VAPID_PRIVATE_KEY: bindings.secret(), VAPID_SUBJECT: bindings.secret(),
    },
  },
})
