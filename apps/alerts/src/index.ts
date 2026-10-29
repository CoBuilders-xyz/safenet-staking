import { api } from "./api.js"
import { poll } from "./poller.js"
import type { Env } from "./types.js"

export default {
  async fetch(request, env) { return api(request, env) },
  async scheduled(_controller, env) {
    try { await poll(env) }
    catch { throw new Error("Alerts poll failed; inspect aggregate run status") }
  },
} satisfies ExportedHandler<Env>
