import { useState, type FormEvent } from "react"
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

export function AlertsPage() {
  const { t } = useTranslation()
  const { address } = useAccount()
  return <div className="space-y-8">
    <PageHero title={t("alerts.title", "Alerts")} subtitle={t("alerts.intro", "Choose wallet alerts. Sign a message to manage subscriptions. No account or custody is required.")} />
    {!address ? <section className="space-y-4"><p>{t("alerts.connect", "Connect your wallet to set up alerts.")}</p><ConnectButton /></section>
      : <ConnectedAlerts key={address} address={address} />}
  </div>
}

function ConnectedAlerts({ address }: { address: Address }) {
  const { t } = useTranslation()
  const alerts = useAlerts(address)
  const [selected, setSelected] = useState<AlertTrigger[]>(["cooldown"])
  const [participation, setParticipation] = useState(75)
  const [missed, setMissed] = useState(3)
  const [channel, setChannel] = useState<"telegram" | "push">("telegram")
  const [pending, setPending] = useState<"sign" | "subscribe" | null>(null)
  const busy = pending !== null
  const [error, setError] = useState<AlertErrorCode | null>(null)
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
  const run = async (name: "sign" | "subscribe", action: () => Promise<unknown>) => {
    setPending(name); setError(null)
    try { await action() } catch (failure) { setError(alertErrorCode(failure)) } finally { setPending(null) }
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
  const shown = error ?? (alerts.subscriptions.isError ? alertErrorCode(alerts.subscriptions.error) : alerts.config.isError ? alertErrorCode(alerts.config.error) : null)
  const creating = pending === "subscribe"
  return <section className="max-w-2xl space-y-6" aria-busy={busy}>
    <p className="text-sm text-muted-foreground">{t("alerts.privacy", "We store your wallet, choices and delivery token until you delete the subscription. Alerts never move funds.")}</p>
    {shown && <p role="alert">{alertErrorMessage(t, shown, maxSubscriptions)}</p>}
    {(!alerts.token || alerts.subscriptions.isError) && <Button disabled={busy} onClick={() => void run("sign", alerts.sign)}>
      {pending === "sign" ? t("alerts.signing", "Waiting for your signature…")
        : alerts.pendingVerification ? t("alerts.retrySignature", "Retry signature verification") : t("alerts.sign", "Sign to manage alerts")}
    </Button>}
    {alerts.token && alerts.subscriptions.isLoading && <SubscriptionCardSkeleton label={t("alerts.loading", "Loading alerts…")} />}
    {alerts.token && <>
      {subscriptions?.length === 0 && !creating && <p>{t("alerts.empty", "You have no alert subscriptions.")}</p>}
      {(!!subscriptions?.length || creating) && <section aria-labelledby="alerts-subscriptions" className="space-y-4">
        <h2 id="alerts-subscriptions" className="font-semibold">{t("alerts.subscriptions", "Your subscriptions")}</h2>
        {subscriptions?.map(sub => <SubscriptionCard key={sub.id} sub={sub} link={links[sub.id]} focusLink={created === sub.id}
          maxSubscriptions={maxSubscriptions} fetchedAt={alerts.subscriptions.dataUpdatedAt} actions={alerts}
          onLink={(id, link) => { setLinks(known => ({ ...known, [id]: link })); void alerts.watchLink() }}
          triggers={<ul className="list-disc pl-5">{sub.triggers.map(trigger => <li key={trigger}>{labels[trigger]}{trigger === "participation" ? ` (${new Intl.NumberFormat(currentLanguage(), { style: "percent", maximumFractionDigits: 1 }).format(sub.participation / 100)})` : trigger === "missed" ? ` (${sub.missed.toLocaleString(currentLanguage())})` : ""}</li>)}</ul>} />)}
        {/* The new subscription holds its place while the service creates it. */}
        {creating && !subscriptions?.some(sub => sub.id === created) && <SubscriptionCardSkeleton label={t("alerts.creating", "Creating your subscription…")} />}
      </section>}
      <form onSubmit={save} aria-labelledby="alerts-add" className="space-y-5">
        <h2 id="alerts-add" className="font-semibold">{t("alerts.addSubscription", "Add a subscription")}</h2>
        <fieldset disabled={busy || atLimit} className="space-y-3">
          <legend className="font-medium mb-3">{t("alerts.chooseTriggers", "Choose triggers")}</legend>
          {(Object.keys(labels) as AlertTrigger[]).map(trigger => <label key={trigger} className="flex items-center gap-3 min-h-11">
            <input type="checkbox" checked={selected.includes(trigger)} onChange={e => setSelected(e.target.checked ? [...selected, trigger] : selected.filter(t => t !== trigger))} />
            {labels[trigger]}
          </label>)}
          {selected.includes("participation") && <label className="block space-y-2">{t("alerts.threshold", "Participation threshold (%)")}<input className="block w-full rounded border p-3 bg-background" type="number" min="0" max="100" step="0.1" value={Number.isNaN(participation) ? "" : participation} required onChange={e => setParticipation(e.target.valueAsNumber)} /></label>}
          {selected.includes("missed") && <label className="block space-y-2">{t("alerts.rounds", "Consecutive rounds (1–1000)")}<input className="block w-full rounded border p-3 bg-background" type="number" min="1" max="1000" value={Number.isNaN(missed) ? "" : missed} required onChange={e => setMissed(e.target.valueAsNumber)} /></label>}
        </fieldset>
        <label className="block space-y-2">{t("alerts.channel", "Delivery channel")}
          <select className="block w-full rounded border p-3 bg-background" value={channel} disabled={busy || atLimit} onChange={e => setChannel(e.target.value === "push" ? "push" : "telegram")}>
            <option value="telegram">{t("alerts.telegram", "Telegram")}</option>
            <option value="push">{t("alerts.browser", "Browser notifications")}</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">{channel === "push" ? t("alerts.browserHelp", "Allow notifications on this device. Keep browser permissions enabled. On iOS, install the app on your home screen first.") : t("alerts.telegramHelpStart", "After you subscribe, open Telegram from the new card and press Start. We send only to the chat you connect.")}</p>
        {atLimit && <p role="status">{t("alerts.limitReached", "You have {{max}} subscriptions, the maximum. Delete one to add another.", { max: maxSubscriptions })}</p>}
        {/* Each reason the button is off is said in words, never by the button alone. */}
        {!atLimit && channelDown && <p role="status">{alertErrorMessage(t, channel === "push" ? "push_unavailable" : "telegram_unavailable", maxSubscriptions)}</p>}
        {!atLimit && !channelDown && duplicate && <p role="status">{t("alerts.duplicateHint", "You already have a Telegram subscription with these same alerts. Change the selection to add another.")}</p>}
        <Button type="submit" disabled={busy || atLimit || duplicate || !selected.length || !channelReady}>
          {creating ? t("alerts.subscribing", "Subscribing…") : t("alerts.subscribe", "Subscribe")}
        </Button>
      </form>
    </>}
  </section>
}
