import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { alertErrorCode, linkPending, type AlertErrorCode, type AlertSubscription, type TelegramLink } from "@/hooks/useAlerts"
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
  newLink: (id: string) => Promise<{ telegramUrl: string; expiresAt: string }>
  sendTest: (id: string) => Promise<unknown>
  setPaused: (id: string, paused: boolean) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
}

/**
 * One subscription: what it watches, one status line, and its own actions. `link` is the
 * Telegram link issued in this page session; the API never returns a link again, so after a
 * reload the card offers a new one. The card opens `link` only while the subscription's current
 * code is that link's own, by its expiry: a newer code makes this link dead.
 */
export function SubscriptionCard({ sub, triggers, link, focusLink, maxSubscriptions, actions, onLink }: {
  sub: AlertSubscription
  triggers: ReactNode
  link: TelegramLink | undefined
  /** Move focus to the Telegram link once, after the subscription was created. */
  focusLink: boolean
  maxSubscriptions: number
  actions: Actions
  onLink: (id: string, link: TelegramLink) => void
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
  const openLink = linkAlive && link?.expiresAt === sub.linkExpiresAt ? link.url : undefined
  const anchor = useRef<HTMLAnchorElement>(null)
  // The link takes the focus when it appears: after the subscription is created, and after
  // "Get a new Telegram link", whose button leaves the card.
  const [issuedHere, setIssuedHere] = useState(false)
  useEffect(() => {
    if ((focusLink || issuedHere) && openLink) anchor.current?.focus()
  }, [focusLink, issuedHere, openLink])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null); setTestSent(false)
    try { await action() } catch (failure) { setError(alertErrorCode(failure)) } finally { setBusy(false) }
  }

  let status: string
  if (expired) {
    status = telegram
      ? t("alerts.statusTelegramBlocked", "Telegram no longer accepts messages for this chat. Delete this subscription and subscribe again.")
      : t("alerts.statusPushExpired", "The browser you subscribed with no longer accepts notifications. Delete this subscription and subscribe again.")
  } else if (unlinked) {
    // A new link cancels the old one, and a Start already sent is read up to 5 minutes later.
    // So the card offers a new link only when it has none to open, and says to wait first.
    status = openLink
      ? t("alerts.statusTelegramWaiting", "Not connected yet. Open Telegram and press Start. After you press Start, connecting can take up to 5 minutes. This page updates by itself.")
      : linkAlive
        ? t("alerts.statusTelegramNoLink", "Not connected yet. If you already pressed Start, wait up to 5 minutes: this page updates by itself. If not, get a new Telegram link, open it and press Start.")
        : t("alerts.statusTelegramLinkExpired", "Still not connected. The Telegram link has expired. If you pressed Start before that, wait up to 5 minutes: this page updates by itself. If not, get a new link, open it and press Start.")
  } else if (sub.paused) {
    status = t("alerts.statusPaused", "Paused. No alerts are sent until you resume.")
  } else if (telegram) {
    status = sub.linkedAt
      ? t("alerts.statusTelegramConnectedSince", "Connected to Telegram since {{date}}.", { date: formatUtcDayLong(Date.parse(sub.linkedAt)) })
      : t("alerts.statusTelegramConnected", "Connected to Telegram.")
  } else {
    status = sub.status === "verified"
      ? t("alerts.statusPushVerified", "Notifications reach the browser you subscribed with.")
      : t("alerts.statusPushUnverified", "Subscribed. Send a test notification: the browser you subscribed with should show it.")
  }

  return <article className="rounded-lg border p-4 space-y-3" aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-medium">{telegram ? t("alerts.telegram", "Telegram") : t("alerts.browser", "Browser notifications")}</h3>
      {sub.paused && !expired && <Badge variant="secondary">{t("alerts.pausedBadge", "Paused")}</Badge>}
    </div>
    {triggers}
    <p role="status" className="font-medium">{status}</p>
    {sub.paused && unlinked && <p>{t("alerts.statusPaused", "Paused. No alerts are sent until you resume.")}</p>}
    {openLink && <p className="text-sm text-muted-foreground">{t("alerts.linkMinutesLeft", "Minutes left on this link: {{minutes}}.", {
      minutes: Math.max(1, Math.ceil((Date.parse(sub.linkExpiresAt!) - now) / 60_000)),
    })}</p>}
    {error && <p role="alert">{alertErrorMessage(t, error, maxSubscriptions)}</p>}
    {testSent && <p role="status">{telegram
      ? t("alerts.testSentTelegram", "Test message sent. Check your Telegram chat.")
      : t("alerts.testSentPush", "Test notification sent. The browser you subscribed with should show it now.")}</p>}
    <div className="flex flex-wrap gap-2">
      {openLink && <Button asChild>
        <a ref={anchor} href={openLink} target="_blank" rel="noreferrer">{t("alerts.linkTelegram", "Open Telegram and press Start")}</a>
      </Button>}
      {unlinked && !openLink && <Button disabled={busy}
        onClick={() => void run(async () => {
          const issued = await actions.newLink(sub.id)
          onLink(sub.id, { url: issued.telegramUrl, expiresAt: issued.expiresAt })
          setIssuedHere(true)
        })}>
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
    {unlinked && !openLink && <p className="text-sm text-muted-foreground">{t("alerts.newLinkHint", "A new link cancels the previous one, and a Start already sent with it.")}</p>}
    {confirmDelete && <div role="group" aria-label={t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")} className="space-y-2">
      <p>{t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => void run(() => actions.remove(sub.id))}>{t("alerts.deleteYes", "Delete")}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("alerts.cancel", "Cancel")}</Button>
      </div>
    </div>}
  </article>
}
