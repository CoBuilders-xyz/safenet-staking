import { Database } from "./db.js"
import { initialChronology, memberCondition, type Chronology } from "./chronology.js"
import { advanceChronology, walletConditions, type Condition } from "./sources.js"
import { sendEvent, telegramUpdates, type TelegramCounts } from "./delivery.js"
import type { Env } from "./types.js"

export interface Adapters {
  advanceChronology: typeof advanceChronology
  walletConditions: typeof walletConditions
  sendEvent: typeof sendEvent
  telegramUpdates: (db: Database, env: Env) => Promise<TelegramCounts | undefined | void>
}
export const adapters: Adapters = { advanceChronology, walletConditions, sendEvent, telegramUpdates }
export async function poll(env: Env, db = new Database(env.DB), io: Adapters = adapters) {
  const holder = crypto.randomUUID()
  if (!await db.lockRun(holder)) return
  const started = new Date().toISOString()
  const deadline = Date.now() + 10 * 60_000
  let evaluated = 0, accepted = 0, failed = 0
  try {
    await db.startRun(started)
    // A Telegram outage must not prevent delivery to already subscribed browsers.
    // Keep the run unhealthy so the failed linking/receipt poll remains visible.
    let telegram: TelegramCounts | undefined | void
    try { telegram = await io.telegramUpdates(db, env) } catch { failed++ }
    let chronology: Awaited<ReturnType<typeof advanceChronology>> | undefined
    let chronologyFailed = false
    let cursor = await db.state<string>("subscription_cursor") ?? ""
    for (;;) {
      const subscriptions = await db.activeSubscriptions(cursor, 50)
      for (const sub of subscriptions) {
        if (sub.channel.kind === "telegram" && !sub.telegram_chat) continue
        evaluated++
        try {
          const { events, validators, failed: sourceFailures } = await io.walletConditions(env, sub)
          failed += sourceFailures
          // Deliver independent chain conditions before attempting Gnosis indexing.
          const pending: Condition[] = []
          for (const event of events) {
            const outcome = await io.sendEvent(db, env, sub, event.key, event.body, undefined, event.covers)
            if (outcome === "accepted") accepted++
            if (outcome === "failed" || outcome === "expired") failed++
          }
          if (sub.triggers.includes("participation") || sub.triggers.includes("missed")) {
            if (chronologyFailed) throw new Error("Aegis chronology unavailable")
            if (!chronology) {
              try {
                const saved = await db.state<Chronology>("aegis")
                chronology = await io.advanceChronology(env, saved ?? initialChronology(), db, holder)
              } catch (error) { chronologyFailed = true; throw error }
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
            const outcome = await io.sendEvent(db, env, sub, event.key, event.body, undefined, event.covers)
            if (outcome === "accepted") accepted++
            if (outcome === "failed" || outcome === "expired") failed++
          }
        } catch { failed++ }
        cursor = sub.id
        if (Date.now() > deadline) break
      }
      if (Date.now() > deadline) {
        await db.saveState("subscription_cursor", cursor)
        break
      }
      if (subscriptions.length < 50) {
        await db.saveState("subscription_cursor", "")
        break
      }
      cursor = subscriptions.at(-1)!.id
    }
    await db.cleanup()
    await db.finishRun(started, { ok: failed === 0, evaluated, accepted, failed })
    // Aggregate-only logs: no wallets, endpoints, signatures, chat IDs or upstream errors.
    console.log(JSON.stringify({ event: "alerts_poll", evaluated, accepted, failed, ...(telegram ? { telegram } : {}) }))
  } finally {
    await db.releaseRun(holder)
  }
}
