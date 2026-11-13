import { useState, type FormEvent } from "react"
import { useAccount } from "wagmi"
import { useTranslation } from "react-i18next"
import type { Address } from "viem"
import { PageHero } from "@/components/PageHero"
import { Button } from "@/components/ui/button"
import { ConnectButton } from "@/components/wallet/ConnectButton"
import { SubscriptionCard } from "@/components/alerts/SubscriptionCard"
import { alertErrorCode, alertRequest, alertsApi, browserChannel, useAlerts, type AlertErrorCode, type AlertTrigger } from "@/hooks/useAlerts"
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
  const [channel, setChannel] = useState("telegram")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AlertErrorCode | null>(null)
  // Telegram links issued in this page session, by subscription. The API returns a link only once.
  const [links, setLinks] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<string | null>(null)
  const labels = {
    cooldown: t("alerts.cooldown", "Cooldown ready to claim"),
    rewards: t("alerts.rewards", "Rewards claimable"),
    deregistered: t("alerts.deregistered", "Validator deregistered"),
    participation: t("alerts.participation", "Participation below my threshold"),
    missed: t("alerts.missed", "Consecutive missed signing rounds"),
  }
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action() } catch (failure) { setError(alertErrorCode(failure)) } finally { setBusy(false) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const delivery = channel === "telegram" ? { kind: "telegram" } : await browserChannel(alerts.config.data?.vapidPublicKey ?? "")
      const result = await alertRequest<{ id: string; telegramUrl: string | null }>("/subscriptions", alerts.token,
        { triggers: selected, participation: selected.includes("participation") ? participation : 75,
          missed: selected.includes("missed") ? missed : 3, channel: delivery })
      if (result.telegramUrl) setLinks(known => ({ ...known, [result.id]: result.telegramUrl! }))
      setCreated(result.id)
      await alerts.refresh()
    })
  }
  if (!alertsApi) return <p role="status">{t("alerts.unavailable", "Alerts are not configured on this deployment. Your wallet remains connected.")}</p>
  const maxSubscriptions = alerts.config.data?.maxSubscriptions ?? 10
  const subscriptions = alerts.subscriptions.data
  const atLimit = (subscriptions?.length ?? 0) >= maxSubscriptions
  // A failed list is a session that ended or a service that did not answer; the Sign button follows it.
  const shown = error ?? (alerts.subscriptions.isError ? alertErrorCode(alerts.subscriptions.error) : alerts.config.isError ? alertErrorCode(alerts.config.error) : null)
  return <section className="max-w-2xl space-y-6" aria-busy={busy}>
    <p className="text-sm text-muted-foreground">{t("alerts.privacy", "We store your wallet, choices and delivery token until you delete the subscription. Alerts never move funds.")}</p>
    {shown && <p role="alert">{alertErrorMessage(t, shown, maxSubscriptions)}</p>}
    {(!alerts.token || alerts.subscriptions.isError) && <Button disabled={busy} onClick={() => void run(alerts.sign)}>{alerts.pendingVerification ? t("alerts.retrySignature", "Retry signature verification") : t("alerts.sign", "Sign to manage alerts")}</Button>}
    {(busy || alerts.config.isLoading || alerts.subscriptions.isLoading) && <p role="status">{t("alerts.loading", "Loading alerts…")}</p>}
    {alerts.token && <>
      {subscriptions?.length === 0 && <p>{t("alerts.empty", "You have no alert subscriptions.")}</p>}
      {!!subscriptions?.length && <section aria-label={t("alerts.subscriptions", "Your subscriptions")} className="space-y-4">
        {subscriptions.map(sub => <SubscriptionCard key={sub.id} sub={sub} linkUrl={links[sub.id]} focusLink={created === sub.id}
          maxSubscriptions={maxSubscriptions} actions={alerts} onLink={(id, url) => { setLinks(known => ({ ...known, [id]: url })); void alerts.refresh() }}
          triggers={<ul className="list-disc pl-5">{sub.triggers.map(trigger => <li key={trigger}>{labels[trigger]}{trigger === "participation" ? ` (${new Intl.NumberFormat(currentLanguage(), { style: "percent", maximumFractionDigits: 1 }).format(sub.participation / 100)})` : trigger === "missed" ? ` (${sub.missed.toLocaleString(currentLanguage())})` : ""}</li>)}</ul>} />)}
      </section>}
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={busy || atLimit} className="space-y-3">
          <legend className="font-semibold mb-3">{t("alerts.chooseTriggers", "Choose triggers")}</legend>
          {(Object.keys(labels) as AlertTrigger[]).map(trigger => <label key={trigger} className="flex items-center gap-3 min-h-11">
            <input type="checkbox" checked={selected.includes(trigger)} onChange={e => setSelected(e.target.checked ? [...selected, trigger] : selected.filter(t => t !== trigger))} />
            {labels[trigger]}
          </label>)}
          {selected.includes("participation") && <label className="block space-y-2">{t("alerts.threshold", "Participation threshold (%)")}<input className="block w-full rounded border p-3 bg-background" type="number" min="0" max="100" step="0.1" value={Number.isNaN(participation) ? "" : participation} required onChange={e => setParticipation(e.target.valueAsNumber)} /></label>}
          {selected.includes("missed") && <label className="block space-y-2">{t("alerts.rounds", "Consecutive rounds (1–1000)")}<input className="block w-full rounded border p-3 bg-background" type="number" min="1" max="1000" value={Number.isNaN(missed) ? "" : missed} required onChange={e => setMissed(e.target.valueAsNumber)} /></label>}
        </fieldset>
        <label className="block space-y-2">{t("alerts.channel", "Delivery channel")}
          <select className="block w-full rounded border p-3 bg-background" value={channel} disabled={busy || atLimit} onChange={e => setChannel(e.target.value)}>
            <option value="telegram">{t("alerts.telegram", "Telegram")}</option>
            <option value="push">{t("alerts.browser", "Browser notifications")}</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">{channel === "push" ? t("alerts.browserHelp", "Allow notifications on this device. Keep browser permissions enabled. On iOS, install the app on your home screen first.") : t("alerts.telegramHelp", "After saving, link your private Telegram chat. We send only to the chat you link.")}</p>
        {atLimit && <p role="status">{t("alerts.limitReached", "You have {{max}} subscriptions, the maximum. Delete one to add another.", { max: maxSubscriptions })}</p>}
        <Button type="submit" disabled={busy || atLimit || !selected.length || (channel === "push" ? !alerts.config.data?.vapidPublicKey : !alerts.config.data?.telegramBot)}>{t("alerts.subscribe", "Subscribe")}</Button>
      </form>
    </>}
  </section>
}
