import { useId, useState, type FormEvent, type ReactNode } from "react"
import { useAccount } from "wagmi"
import { useTranslation } from "react-i18next"
import type { Address } from "viem"
import { PageHero } from "@/components/PageHero"
import { Button } from "@/components/ui/button"
import { ConnectButton } from "@/components/wallet/ConnectButton"
import { SubscriptionCard, SubscriptionCardSkeleton } from "@/components/alerts/SubscriptionCard"
import { alertErrorCode, alertRequest, alertsApi, browserChannel, useAlerts, type AlertErrorCode, type AlertTrigger, type TelegramLink } from "@/hooks/useAlerts"
import { currentLanguage } from "@/i18n"
import { alertErrorMessage } from "@/lib/alertMessages"

const sectionTitle = "font-heading text-xl font-semibold tracking-tight"
const stepTitle = "text-base font-semibold"
const groupTitle = "text-sm font-semibold text-muted-foreground"
const field = "block h-11 rounded-md border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"

export function AlertsPage() {
  const { t } = useTranslation()
  const { address } = useAccount()
  return <div className="space-y-8">
    <PageHero title={t("alerts.title", "Alerts")} subtitle={t("alerts.intro", "Choose wallet alerts. Sign a message to manage subscriptions. No account or custody is required.")} />
    {!address ? <section className="space-y-4"><p>{t("alerts.connect", "Connect your wallet to set up alerts.")}</p><ConnectButton /></section>
      : <ConnectedAlerts key={address} address={address} />}
  </div>
}

/** One numbered step of the form. The list around it gives the order; the number repeats it for the eye. */
function Step({ number, children }: { number: number; children: ReactNode }) {
  return <li className="flex gap-4 py-6 first:pt-0 last:pb-0">
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{number.toLocaleString(currentLanguage())}</span>
    <div className="min-w-0 flex-1 space-y-4">{children}</div>
  </li>
}

/**
 * One trigger: a box that selects it, its name, and one line on when it fires. The name alone is
 * the checkbox's accessible name; the line, and the note of its group, are its description.
 */
function TriggerOption({ label, hint, groupHint, checked, onChange, children }: {
  label: string; hint: string; groupHint?: string; checked: boolean; onChange: (checked: boolean) => void
  /** The threshold of this trigger, shown under it while it is selected. */
  children?: ReactNode
}) {
  const id = useId()
  return <div className="rounded-md border border-border bg-card has-[:checked]:border-primary/60 has-[:checked]:bg-accent/40">
    <label className="flex cursor-pointer items-start gap-3 p-3 min-h-11">
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={checked} onChange={e => onChange(e.target.checked)}
        aria-labelledby={`${id}-label`} aria-describedby={groupHint ? `${id}-hint ${groupHint}` : `${id}-hint`} />
      <span className="space-y-0.5">
        <span id={`${id}-label`} className="block font-medium">{label}</span>
        <span id={`${id}-hint`} className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
    {children && <div className="px-3 pb-3 pl-10">{children}</div>}
  </div>
}

function ConnectedAlerts({ address }: { address: Address }) {
  const { t } = useTranslation()
  const ids = useId()
  const alerts = useAlerts(address)
  const [selected, setSelected] = useState<AlertTrigger[]>(["cooldown"])
  const [participation, setParticipation] = useState(75)
  const [missed, setMissed] = useState(3)
  const [channel, setChannel] = useState<"telegram" | "push">("telegram")
  const [pending, setPending] = useState<"sign" | "subscribe" | null>(null)
  const busy = pending !== null
  // A failure, and the request it belongs to: the message appears next to the control that caused it.
  const [error, setError] = useState<{ code: AlertErrorCode; during: "sign" | "subscribe" } | null>(null)
  // Telegram links issued in this page session, by subscription. The API returns a link only once.
  const [links, setLinks] = useState<Record<string, TelegramLink>>({})
  const [created, setCreated] = useState<string | null>(null)
  const labels = {
    cooldown: t("alerts.cooldown", "Cooldown ready to claim"),
    rewards: t("alerts.rewards", "Rewards claimable"),
    deregistered: t("alerts.deregistered", "Validator deregistered"),
    participation: t("alerts.participation", "Participation below my threshold"),
    missed: t("alerts.missed", "Consecutive missed signing rounds"),
  }
  // When each trigger fires, as the poller in apps/alerts decides it.
  const hints = {
    cooldown: t("alerts.cooldownHint", "A withdrawal from this wallet finished its cooldown and can be claimed."),
    rewards: t("alerts.rewardsHint", "A verified reward proof shows rewards this wallet has not claimed yet."),
    deregistered: t("alerts.deregisteredHint", "A validator you delegate to is no longer registered."),
    participation: t("alerts.participationHint", "A validator you delegate to is below your threshold over complete Aegis days (up to 14). At most one alert per UTC day."),
    missed: t("alerts.missedHint", "A validator you delegate to misses your number of attested signing rounds in a row. One alert per streak."),
  }
  const toggle = (trigger: AlertTrigger) => (checked: boolean) => setSelected(checked ? [...selected, trigger] : selected.filter(t => t !== trigger))
  const run = async (name: "sign" | "subscribe", action: () => Promise<unknown>) => {
    setPending(name); setError(null)
    try { await action() } catch (failure) { setError({ code: alertErrorCode(failure), during: name }) } finally { setPending(null) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    setCreated(null) // The subscription created before is in the list; the placeholder is for this one.
    void run("subscribe", async () => {
      const delivery = channel === "telegram" ? { kind: "telegram" } : await browserChannel(alerts.config.data?.vapidPublicKey ?? "")
      const result = await alertRequest<{ id: string; telegramUrl: string | null; expiresAt: string | null }>("/subscriptions", alerts.token,
        { triggers: selected, participation: selected.includes("participation") ? participation : 75,
          missed: selected.includes("missed") ? missed : 3, channel: delivery })
      const { telegramUrl, expiresAt } = result
      if (telegramUrl && expiresAt) setLinks(known => ({ ...known, [result.id]: { url: telegramUrl, expiresAt } }))
      setCreated(result.id)
      // The new card is in the list before the form is free again, and its link is read at the fast rate.
      await alerts.watchLink()
    })
  }
  if (!alertsApi) return <p role="status">{t("alerts.unavailable", "Alerts are not configured on this deployment. Your wallet remains connected.")}</p>
  const maxSubscriptions = alerts.config.data?.maxSubscriptions ?? 10
  const subscriptions = alerts.subscriptions.data
  const atLimit = (subscriptions?.length ?? 0) >= maxSubscriptions
  // The service refuses a second subscription with the same alerts on the same destination. For
  // Telegram the page knows before asking; for a browser only the service knows the device.
  const duplicate = channel === "telegram" && !!subscriptions?.some(sub => sub.channel === "telegram" && sub.status !== "expired"
    && sub.triggers.length === selected.length && selected.every(trigger => sub.triggers.includes(trigger))
    && (!selected.includes("participation") || sub.participation === participation) && (!selected.includes("missed") || sub.missed === missed))
  const channelReady = channel === "push" ? !!alerts.config.data?.vapidPublicKey : !!alerts.config.data?.telegramBot
  const channelDown = alerts.config.isSuccess && !channelReady
  // A failed list is a session that ended or a service that did not answer; the Sign button follows it.
  const shown = (error?.during === "sign" ? error.code : null)
    ?? (alerts.subscriptions.isError ? alertErrorCode(alerts.subscriptions.error) : alerts.config.isError ? alertErrorCode(alerts.config.error) : null)
  // A refused subscription is said above its own button: the top of the page can be off screen.
  const formError = error?.during === "subscribe" ? error.code : null
  const creating = pending === "subscribe"
  const percent = new Intl.NumberFormat(currentLanguage(), { style: "percent", maximumFractionDigits: 1 })
  const id = (name: string) => `${ids}-${name}`
  return <section className="max-w-3xl space-y-10" aria-busy={busy}>
    {shown && <p role="alert">{alertErrorMessage(t, shown, maxSubscriptions)}</p>}
    {(!alerts.token || alerts.subscriptions.isError) && <Button disabled={busy} onClick={() => void run("sign", alerts.sign)}>
      {pending === "sign" ? t("alerts.signing", "Waiting for your signature…")
        : alerts.pendingVerification ? t("alerts.retrySignature", "Retry signature verification") : t("alerts.sign", "Sign to manage alerts")}
    </Button>}
    {alerts.token && <>
      {(subscriptions || alerts.subscriptions.isLoading || creating) && <section aria-labelledby={id("subscriptions")} className="space-y-4">
        <h2 id={id("subscriptions")} className={sectionTitle}>{t("alerts.subscriptions", "Your subscriptions")}</h2>
        {alerts.subscriptions.isLoading && <SubscriptionCardSkeleton label={t("alerts.loading", "Loading alerts…")} />}
        {subscriptions?.length === 0 && !creating && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-muted-foreground">{t("alerts.empty", "You have no alert subscriptions.")}</p>}
        {subscriptions?.map(sub => <SubscriptionCard key={sub.id} sub={sub} link={links[sub.id]} focusLink={created === sub.id}
          maxSubscriptions={maxSubscriptions} fetchedAt={alerts.subscriptions.dataUpdatedAt} actions={alerts}
          onLink={(id, link) => { setLinks(known => ({ ...known, [id]: link })); return alerts.watchLink() }}
          triggers={<ul className="list-disc pl-5 text-sm">{sub.triggers.map(trigger => <li key={trigger}>{labels[trigger]}{trigger === "participation" ? ` (${percent.format(sub.participation / 100)})` : trigger === "missed" ? ` (${sub.missed.toLocaleString(currentLanguage())})` : ""}</li>)}</ul>} />)}
        {/* The new subscription holds its place while the service creates it. */}
        {creating && !subscriptions?.some(sub => sub.id === created) && <SubscriptionCardSkeleton label={t("alerts.creating", "Creating your subscription…")} />}
      </section>}
      {/* A refusal belongs to the choice that was sent: changing the choice removes it. */}
      <form onSubmit={save} onChange={() => { if (error?.during === "subscribe") setError(null) }} aria-labelledby={id("add")}
        className="rounded-xl border border-border bg-card text-card-foreground" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="space-y-1 border-b border-border px-5 py-4 sm:px-6">
          <h2 id={id("add")} className={sectionTitle}>{t("alerts.addSubscription", "Add a subscription")}</h2>
          <p className="text-sm text-muted-foreground">{t("alerts.addSubscriptionIntro", "Choose what to watch, then where to receive it.")}</p>
        </div>
        <ol className="divide-y divide-border px-5 py-6 sm:px-6">
          <Step number={1}>
            <fieldset disabled={busy || atLimit} className="space-y-5" aria-describedby={id("interval")}>
              <legend><h3 className={stepTitle}>{t("alerts.chooseTriggers", "Choose triggers")}</h3></legend>
              <p id={id("interval")} className="-mt-4 text-sm text-muted-foreground">{t("alerts.checkInterval", "Checks run about every 5 minutes.")}</p>
              <fieldset className="space-y-2">
                <legend className="mb-2"><h4 className={groupTitle}>{t("alerts.groupWallet", "This wallet")}</h4></legend>
                {(["cooldown", "rewards"] as const).map(trigger => <TriggerOption key={trigger} label={labels[trigger]} hint={hints[trigger]}
                  checked={selected.includes(trigger)} onChange={toggle(trigger)} />)}
              </fieldset>
              <fieldset className="space-y-2" aria-describedby={id("validators")}>
                <legend><h4 className={groupTitle}>{t("alerts.groupValidators", "Validators you delegate to")}</h4></legend>
                <p id={id("validators")} className="text-sm text-muted-foreground">{t("alerts.groupValidatorsHint", "Only validators this wallet has an active stake on, on Ethereum. With no delegation, these never fire.")}</p>
                <TriggerOption label={labels.deregistered} hint={hints.deregistered} groupHint={id("validators")}
                  checked={selected.includes("deregistered")} onChange={toggle("deregistered")} />
                <TriggerOption label={labels.participation} hint={hints.participation} groupHint={id("validators")}
                  checked={selected.includes("participation")} onChange={toggle("participation")}>
                  {selected.includes("participation") && <label className="block space-y-1.5 text-sm font-medium">{t("alerts.threshold", "Participation threshold (%)")}
                    <input className={`${field} w-32`} type="number" min="0" max="100" step="0.1" value={Number.isNaN(participation) ? "" : participation} required onChange={e => setParticipation(e.target.valueAsNumber)} />
                  </label>}
                </TriggerOption>
                <TriggerOption label={labels.missed} hint={hints.missed} groupHint={id("validators")}
                  checked={selected.includes("missed")} onChange={toggle("missed")}>
                  {selected.includes("missed") && <label className="block space-y-1.5 text-sm font-medium">{t("alerts.rounds", "Consecutive rounds (1–1000)")}
                    <input className={`${field} w-32`} type="number" min="1" max="1000" value={Number.isNaN(missed) ? "" : missed} required onChange={e => setMissed(e.target.valueAsNumber)} />
                  </label>}
                </TriggerOption>
              </fieldset>
            </fieldset>
          </Step>
          <Step number={2}>
            <h3 className={stepTitle}>{t("alerts.stepChannel", "Choose where to receive alerts")}</h3>
            <div className="space-y-2">
              <label htmlFor={id("channel")} className="block text-sm font-medium">{t("alerts.channel", "Delivery channel")}</label>
              <select id={id("channel")} className={`${field} w-full`} value={channel} disabled={busy || atLimit} aria-describedby={id("channel-help")}
                onChange={e => setChannel(e.target.value === "push" ? "push" : "telegram")}>
                <option value="telegram">{t("alerts.telegram", "Telegram")}</option>
                <option value="push">{t("alerts.browser", "Browser notifications")}</option>
              </select>
              <p id={id("channel-help")} className="text-sm text-muted-foreground">{channel === "push" ? t("alerts.browserHelp", "Allow notifications on this device. Keep browser permissions enabled. On iOS, install the app on your home screen first.") : t("alerts.telegramHelpStart", "After you subscribe, open Telegram from the new card and press Start. We send only to the chat you connect.")}</p>
              {/* Each reason the button is off is said in words, never by the button alone. */}
              {!atLimit && channelDown && <p role="status" className="text-sm">{alertErrorMessage(t, channel === "push" ? "push_unavailable" : "telegram_unavailable", maxSubscriptions)}</p>}
            </div>
          </Step>
          <Step number={3}>
            <h3 className={stepTitle}>{t("alerts.stepConfirm", "Confirm")}</h3>
            <p id={id("privacy")} className="text-sm text-muted-foreground">{t("alerts.privacy", "We store your wallet, choices and delivery token until you delete the subscription. Alerts never move funds.")}</p>
            {atLimit && <p role="status" className="text-sm">{t("alerts.limitReached", "You have {{max}} subscriptions, the maximum. Delete one to add another.", { max: maxSubscriptions })}</p>}
            {!atLimit && !channelDown && duplicate && <p role="status" className="text-sm text-muted-foreground">{t("alerts.duplicateHint", "You already have a Telegram subscription with these same alerts. Change the selection to add another.")}</p>}
            {formError && <p role="alert" className="text-sm text-destructive">{alertErrorMessage(t, formError, maxSubscriptions)}</p>}
            <Button type="submit" aria-describedby={id("privacy")} disabled={busy || atLimit || duplicate || !selected.length || !channelReady}>
              {creating ? t("alerts.subscribing", "Subscribing…") : t("alerts.subscribe", "Subscribe")}
            </Button>
          </Step>
        </ol>
      </form>
    </>}
  </section>
}
