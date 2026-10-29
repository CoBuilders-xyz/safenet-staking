import { Database } from "./db.js"
import { initialChronology, memberCondition, type Chronology } from "./chronology.js"
import { advanceChronology, walletConditions, type Condition } from "./sources.js"
import { sendEvent, telegramUpdates } from "./delivery.js"
import type { Env, Subscription } from "./types.js"

export const adapters = { advanceChronology, walletConditions, sendEvent, telegramUpdates }
export async function poll(env: Env, db = new Database(env), io = adapters) {
  const holder = crypto.randomUUID()
  if (!await db.rpc<boolean>("lock_run", { holder })) return
  const started = new Date().toISOString()
  const deadline = Date.now() + 10 * 60_000
  let evaluated = 0, accepted = 0, failed = 0
  try {
    await db.request("alerts_runs", "POST", { started_at: started })
    // A Telegram outage must not prevent delivery to already subscribed browsers.
    // Keep the run unhealthy so the failed linking/receipt poll remains visible.
    try { await io.telegramUpdates(db, env) } catch { failed++ }
    let chronology: Awaited<ReturnType<typeof advanceChronology>> | undefined
    const savedCursor = await db.request<{ value: string }[]>("alerts_state?key=eq.subscription_cursor")
    let cursor = savedCursor[0]?.value ?? ""
    for (;;) {
      const subscriptions = await db.request<Subscription[]>(`alerts_subscriptions?status=neq.expired&order=id.asc&limit=50${cursor ? `&id=gt.${cursor}` : ""}`)
      for (const sub of subscriptions) {
        if (sub.channel.kind === "telegram" && !sub.telegram_chat) continue
        evaluated++
        try {
          const { events, validators, failed: sourceFailures } = await io.walletConditions(env, sub)
          failed += sourceFailures
          // Deliver independent chain conditions before attempting Gnosis indexing.
          const pending: Condition[] = []
          for (const event of events) {
            const outcome = await io.sendEvent(db, env, sub, event.key, event.body)
            if (outcome === "accepted") accepted++
            if (outcome === "failed" || outcome === "expired") failed++
          }
          if (sub.triggers.includes("participation") || sub.triggers.includes("missed")) {
            if (!chronology) {
              const rows = await db.request<{ value: Chronology }[]>("alerts_state?key=eq.aegis")
              chronology = await io.advanceChronology(env, rows[0]?.value ?? initialChronology())
              await db.rpc("save_state", { state_key: "aegis", state_value: chronology.state })
            }
            if (!chronology.current) failed++
            else for (const validator of validators) {
              for (const condition of memberCondition(chronology.state, validator, chronology.time)) {
                if (sub.triggers.includes("participation") && condition.participation !== null && condition.participation < sub.participation) {
                  // One warning per threshold per complete UTC day, not every Cron invocation.
                  pending.push({ trigger: "participation", key: `participation:${condition.signer}:${sub.participation}:${Math.floor(chronology.time / 86400)}`,
                    body: `Validator ${validator} participation is below your ${sub.participation}% threshold over complete Aegis days (up to 14).` })
                }
                if (sub.triggers.includes("missed") && condition.misses >= sub.missed) {
                  pending.push({ trigger: "missed", key: `missed:${condition.signer}:${condition.streakStart}:${sub.missed}`,
                    body: `Validator ${validator} has missed ${condition.misses} consecutive attested signing rounds.` })
                }
              }
            }
          }
          for (const event of pending) {
            const outcome = await io.sendEvent(db, env, sub, event.key, event.body)
            if (outcome === "accepted") accepted++
            if (outcome === "failed" || outcome === "expired") failed++
          }
        } catch { failed++ }
        cursor = sub.id
        if (Date.now() > deadline) break
      }
      if (Date.now() > deadline) {
        await db.rpc("save_state", { state_key: "subscription_cursor", state_value: cursor })
        break
      }
      if (subscriptions.length < 50) {
        await db.rpc("save_state", { state_key: "subscription_cursor", state_value: "" })
        break
      }
      cursor = subscriptions.at(-1)!.id
    }
    await db.rpc("cleanup", {})
    await db.request(`alerts_runs?started_at=eq.${encodeURIComponent(started)}`, "PATCH", { completed_at: new Date().toISOString(), ok: failed === 0, evaluated, accepted, failed })
    // Aggregate-only logs: no wallets, endpoints, signatures, chat IDs or upstream errors.
    console.log(JSON.stringify({ event: "alerts_poll", evaluated, accepted, failed }))
  } finally {
    await db.rpc("lock_run", { holder, release: true })
  }
}
