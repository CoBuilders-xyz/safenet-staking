import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { alertErrorCode, linkPending, type AlertErrorCode, type AlertSubscription } from "@/hooks/useAlerts"
import { alertErrorMessage } from "@/lib/alertMessages"
import { formatUtcDayLong } from "@/lib/format"

/** The current time, refreshed every ten seconds while `active`, for the minutes left on a link. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

interface Actions {
  newLink: (id: string) => Promise<{ telegramUrl: string }>
  sendTest: (id: string) => Promise<unknown>
  setPaused: (id: string, paused: boolean) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
}

/**
 * One subscription: what it watches, one status line, and its own actions. `linkUrl` is the
 * Telegram link issued in this page session; the API never returns a link again, so after a
 * reload the card offers a new one.
 */
export function SubscriptionCard({ sub, triggers, linkUrl, focusLink, maxSubscriptions, actions, onLink }: {
  sub: AlertSubscription
  triggers: ReactNode
  linkUrl: string | undefined
  /** Move focus to the Telegram link once, after the subscription was created. */
  focusLink: boolean
  maxSubscriptions: number
  actions: Actions
  onLink: (id: string, url: string) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AlertErrorCode | null>(null)
  const [testSent, setTestSent] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const telegram = sub.channel === "telegram"
  const expired = sub.status === "expired"
  const unlinked = telegram && !sub.linked && !expired
  const now = useNow(unlinked)
  const linkAlive = linkPending(sub, now)
  const openLink = linkAlive ? linkUrl : undefined
  const anchor = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (focusLink && openLink) anchor.current?.focus()
  }, [focusLink, openLink])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null); setTestSent(false)
    try { await action() } catch (failure) { setError(alertErrorCode(failure)) } finally { setBusy(false) }
  }

  let status: string
  if (expired) {
    status = telegram
      ? t("alerts.statusTelegramBlocked", "Telegram no longer accepts messages for this chat. Delete this subscription and subscribe again.")
      : t("alerts.statusPushExpired", "This browser no longer accepts notifications. Delete this subscription and subscribe again.")
  } else if (unlinked) {
    status = openLink
      ? t("alerts.statusTelegramWaiting", "Not connected yet. Open Telegram and press Start. After you press Start, connecting can take up to 5 minutes.")
      : linkUrl
        ? t("alerts.statusTelegramLinkExpired", "Still not connected. This Telegram link has expired. Get a new link, open it and press Start.")
        : t("alerts.statusTelegramNoLink", "Not connected. Get a new Telegram link, open it and press Start.")
  } else if (sub.paused) {
    status = t("alerts.statusPaused", "Paused. No alerts are sent until you resume.")
  } else if (telegram) {
    status = sub.linkedAt
      ? t("alerts.statusTelegramConnectedSince", "Connected to Telegram since {{date}}.", { date: formatUtcDayLong(Date.parse(sub.linkedAt)) })
      : t("alerts.statusTelegramConnected", "Connected to Telegram.")
  } else {
    status = sub.status === "verified"
      ? t("alerts.statusPushVerified", "Notifications reach this browser.")
      : t("alerts.statusPushUnverified", "Subscribed. Send a test notification to check that this browser shows it.")
  }

  return <article className="rounded-lg border p-4 space-y-3" aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-medium">{telegram ? t("alerts.telegram", "Telegram") : t("alerts.browser", "Browser notifications")}</h3>
      {sub.paused && unlinked && <Badge variant="secondary">{t("alerts.pausedBadge", "Paused")}</Badge>}
    </div>
    {triggers}
    <p role="status" className="font-medium">{status}</p>
    {openLink && <p className="text-sm text-muted-foreground">{t("alerts.linkMinutesLeft", "Minutes left on this link: {{minutes}}.", {
      minutes: Math.max(1, Math.ceil((Date.parse(sub.linkExpiresAt!) - now) / 60_000)).toLocaleString("en"),
    })}</p>}
    {error && <p role="alert">{alertErrorMessage(t, error, maxSubscriptions)}</p>}
    {testSent && <p role="status">{telegram
      ? t("alerts.testSentTelegram", "Test message sent. Check your Telegram chat.")
      : t("alerts.testSentPush", "Test notification sent. This browser should show it now.")}</p>}
    <div className="flex flex-wrap gap-2">
      {openLink && <Button asChild>
        <a ref={anchor} href={openLink} target="_blank" rel="noreferrer">{t("alerts.linkTelegram", "Open Telegram and press Start")}</a>
      </Button>}
      {unlinked && <Button variant={openLink ? "outline" : "default"} disabled={busy}
        onClick={() => void run(async () => onLink(sub.id, (await actions.newLink(sub.id)).telegramUrl))}>
        {t("alerts.newLink", "Get a new Telegram link")}
      </Button>}
      {!expired && !unlinked && <Button variant="outline" disabled={busy}
        onClick={() => void run(async () => { await actions.sendTest(sub.id); setTestSent(true) })}>
        {telegram ? t("alerts.sendTestTelegram", "Send test message") : t("alerts.sendTestPush", "Send test notification")}
      </Button>}
      {!expired && <Button variant="outline" disabled={busy} onClick={() => void run(() => actions.setPaused(sub.id, !sub.paused))}>
        {sub.paused ? t("alerts.resume", "Resume") : t("alerts.pause", "Pause")}
      </Button>}
      {!confirmDelete && <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>{t("alerts.delete", "Delete subscription")}</Button>}
    </div>
    {confirmDelete && <div role="group" aria-label={t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")} className="space-y-2">
      <p>{t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => void run(() => actions.remove(sub.id))}>{t("alerts.deleteYes", "Delete")}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("alerts.cancel", "Cancel")}</Button>
      </div>
    </div>}
  </article>
}
