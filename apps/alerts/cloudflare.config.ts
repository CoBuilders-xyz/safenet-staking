import { bindings, defineConfig, triggers } from "cf/config"

export default defineConfig({
  worker: {
    name: "safenet-alerts",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-29",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    // Provider URLs can contain bot tokens. Keep tracing enabled but sample no URL spans.
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: false }, traces: { enabled: true, headSamplingRate: 0 } },
    triggers: [triggers.scheduled({ schedule: "*/5 * * * *" })],
    env: {
      APP_ORIGIN: bindings.secret(), APP_ORIGINS: bindings.secret(), SUPABASE_URL: bindings.secret(), SUPABASE_SERVICE_KEY: bindings.secret(),
      MAINNET_RPC_URL: bindings.secret(), GNOSIS_RPC_URL: bindings.secret(), SUBGRAPH_URL_MAINNET: bindings.secret(),
      REWARDS_BASE_URL: bindings.secret(), TELEGRAM_BOT_TOKEN: bindings.secret(), TELEGRAM_BOT_NAME: bindings.secret(),
      VAPID_PUBLIC_KEY: bindings.secret(), VAPID_PRIVATE_KEY: bindings.secret(), VAPID_SUBJECT: bindings.secret(),
    },
  },
})
